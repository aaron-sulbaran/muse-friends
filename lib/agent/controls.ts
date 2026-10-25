import {
  AgentMessage,
  CATEGORIES,
  PAYMENT_MAX_DOLLARS,
  isPaymentType,
  SharePolicy,
  TIER_DEFAULTS,
  type AgentId,
  type BusyBlock,
  type Category,
  type RecordedRun,
  type Redaction,
  type ShareTier,
} from "@/lib/protocol";
import { enforceSharePolicy } from "@/lib/policy";
import { CALENDAR_RANGE, displayName, getPersona, seedSnapshot } from "@/lib/seed/fixtures";
import type { Store } from "@/lib/store";
import type { LifecycleResult } from "./lifecycle";
import { newId } from "./ids";
import { PLAN_LOCK, withLock } from "./lock";
import { PAYMENTS_OFF_TEXT, carryWallets, ensureWallets, paymentsEnabled } from "./wallets";
import { describeWindow, toCentralIso, toMs } from "./windows";

// What the demo controls do to the engine. Lane B's routes call these; they hold the rules.

type Options = { wallNow?: () => number };

const nowIso = (options: Options) => toCentralIso(options.wallNow?.() ?? Date.now());

// What a tier switches on: the protocol's one tier table. Picking a tier writes all of it as explicit categories, so
// the switches on screen always follow the tier the person just picked, whichever sheet they picked it in.
export function categoriesForTier(tier: ShareTier): Record<Category, boolean> {
  return { ...TIER_DEFAULTS[tier] };
}

// Changes what one person shares with a friend, then replays that person's messages under the new
// setting: anything the setting now forbids is removed from the stored message, the stamp turns to
// "withheld", and a redaction names the category (never the value). Turning something back on only
// affects messages sent from then on.
export function setSharePolicy(
  store: Store,
  input: { owner: AgentId; friend: AgentId; tier?: ShareTier; categories?: Partial<Record<(typeof CATEGORIES)[number], boolean>> },
  options: Options = {},
): Promise<LifecycleResult<{ policy: SharePolicy; replayed: Redaction[] }>> {
  return withLock(PLAN_LOCK, () => setSharePolicyLocked(store, input, options));
}

async function setSharePolicyLocked(
  store: Store,
  input: { owner: AgentId; friend: AgentId; tier?: ShareTier; categories?: Partial<Record<(typeof CATEGORIES)[number], boolean>> },
  options: Options,
): Promise<LifecycleResult<{ policy: SharePolicy; replayed: Redaction[] }>> {
  if (input.owner === input.friend) return { ok: false, status: 422, error: "a person cannot share with themselves" };
  const at = nowIso(options);
  const existing = (await store.getPolicy(input.owner, input.friend)) ?? { owner: input.owner, friend: input.friend, tier: "off" as const, categories: {} };
  const policy = SharePolicy.parse({
    ...existing,
    tier: input.tier ?? existing.tier,
    categories: { ...existing.categories, ...input.categories },
  });
  await store.putPolicy(policy);

  const changes = Object.entries({ ...(input.tier ? { tier: input.tier } : {}), ...input.categories })
    .map(([key, value]) => (key === "tier" ? `tier ${value}` : `${key} ${value ? "on" : "off"}`))
    .join(", ");
  const plans = await store.listPlans();
  const plan = plans.find((candidate) => candidate.participants.includes(input.owner) && candidate.participants.includes(input.friend) && candidate.state !== "dropped") ?? plans.at(-1);
  await store.appendEvent({
    id: newId("evt"),
    at,
    kind: "policy_changed",
    actor: "human",
    agent: input.owner,
    contextId: plan?.contextId,
    planId: plan?.id,
    text: `${displayName(input.owner)} changed sharing with ${displayName(input.friend)}: ${changes || "no change"}`,
  });

  const replayed: Redaction[] = [];
  for (const record of await store.listMessages()) {
    const { message } = record;
    if (message.from !== input.owner || message.to !== input.friend) continue;
    // Money already moved is history; a sharing switch does not rewrite a payment.
    if (isPaymentType(message.type)) continue;
    const outcome = enforceSharePolicy({ message, policy, sender: getPersona(input.owner), windowsDropped: record.stamp.windowsDropped });
    if (outcome.removed.length === 0) continue;

    const rewritten = AgentMessage.safeParse(outcome.message);
    if (!rewritten.success) continue; // The message cannot stand without the removed part; leave it as sent.
    const thread = await store.getThread(message.contextId);
    const redaction: Redaction = {
      id: newId("red"),
      contextId: message.contextId,
      messageId: message.id,
      from: message.from,
      to: message.to,
      removed: outcome.removed,
      detail: `${outcome.redaction?.detail.replace(/\.$/, "")} (replayed under the new setting).`,
      at,
    };
    await store.replaceMessage({
      ...record,
      message: rewritten.data,
      stamp: { passed: outcome.stamp.passed, removed: [...new Set([...record.stamp.removed, ...outcome.removed])], windowsDropped: record.stamp.windowsDropped },
    });
    await store.appendRedaction(redaction);
    await store.appendEvent({
      id: newId("evt"),
      at,
      kind: "redaction",
      actor: "system",
      agent: message.from,
      contextId: message.contextId,
      planId: thread?.planId,
      messageId: message.id,
      redactionId: redaction.id,
      text: `Policy removed ${outcome.removed.join(", ")} from ${displayName(message.from)}'s ${message.type}`,
    });
    replayed.push(redaction);
  }
  return { ok: true, value: { policy, replayed } };
}

// A judge marks a time as busy; the agents' calendar tool and window checks include it from then on.
export async function addBusyBlock(
  store: Store,
  input: { agent: AgentId; start: string; end: string; title?: string },
  options: Options = {},
): Promise<LifecycleResult<BusyBlock>> {
  const start = toMs(input.start);
  const end = toMs(input.end);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return { ok: false, status: 422, error: "start and end must be times with end after start" };
  if (start < toMs(CALENDAR_RANGE.start) || end > toMs(CALENDAR_RANGE.end)) return { ok: false, status: 422, error: "outside the calendar range" };
  const block: BusyBlock = {
    agent: input.agent,
    // Private by default, so the title can never travel in a note.
    event: { id: newId("busy"), title: input.title?.slice(0, 80) || "Busy", start: toCentralIso(start), end: toCentralIso(end), private: true },
  };
  await store.addBusy(block);
  await store.appendEvent({
    id: newId("evt"),
    at: nowIso(options),
    kind: "busy_added",
    actor: "human",
    agent: input.agent,
    text: `${displayName(input.agent)} marked ${describeWindow(block.event)} as busy`,
  });
  return { ok: true, value: block };
}

// Lets one person's Muse send money to a friend, up to a cap per plan, or switches that off. Off is the default; a
// cap of 0 is off. This is the whole of what a person controls about payments: the amounts are the Muse's call.
export async function setPayments(
  store: Store,
  input: { owner: AgentId; friend: AgentId; enabled: boolean; capPerPlan?: number },
  options: Options = {},
): Promise<LifecycleResult<{ policy: SharePolicy }>> {
  if (input.owner === input.friend) return { ok: false, status: 422, error: "a person cannot pay themselves" };
  if (!paymentsEnabled()) return { ok: false, status: 409, error: PAYMENTS_OFF_TEXT };
  const existing = (await store.getPolicy(input.owner, input.friend)) ?? { owner: input.owner, friend: input.friend, tier: "off" as const, categories: {} };
  const capPerPlan = input.enabled ? (input.capPerPlan ?? existing.payments?.capPerPlan ?? 20) : (existing.payments?.capPerPlan ?? 0);
  const parsed = SharePolicy.safeParse({ ...existing, payments: { enabled: input.enabled && capPerPlan > 0, capPerPlan } });
  if (!parsed.success) return { ok: false, status: 422, error: `the cap must be a whole number of dollars from 0 to ${PAYMENT_MAX_DOLLARS}` };
  await store.putPolicy(parsed.data);
  const scope = parsed.data.payments!;
  const plans = await store.listPlans();
  const plan = plans.find((candidate) => candidate.participants.includes(input.owner) && candidate.participants.includes(input.friend) && candidate.state !== "dropped") ?? plans.at(-1);
  await store.appendEvent({
    id: newId("evt"),
    at: nowIso(options),
    kind: "policy_changed",
    actor: "human",
    agent: input.owner,
    contextId: plan?.contextId,
    planId: plan?.id,
    text: scope.enabled
      ? `${displayName(input.owner)} lets their Muse settle up with ${displayName(input.friend)}: up to $${scope.capPerPlan} per plan`
      : `${displayName(input.owner)} turned payments off for ${displayName(input.friend)}`,
  });
  return { ok: true, value: { policy: parsed.data } };
}

// Wipes live state back to the seed (policies, clock, empty threads). Saved recorded runs survive.
export async function resetDemo(store: Store, input: { simulatedFriend?: boolean } = {}, options: Options = {}): Promise<{ resetCount: number }> {
  const room = await store.getRoom();
  const at = nowIso(options);
  const resetCount = room.resetCount + 1;
  const fresh = seedSnapshot();
  await store.replaceAll({ ...fresh, room: { id: "demo", simulatedFriend: input.simulatedFriend ?? room.simulatedFriend, resetCount, ...(paymentsEnabled() ? carryWallets(room) : {}), updatedAt: at } });
  await store.appendEvent({ id: newId("evt"), at, kind: "room_reset", actor: "system", text: "Demo reset" });
  // The wallets are put back to their starting balance. A ledger error never fails the Reset.
  if (paymentsEnabled()) {
    try {
      const { errors } = await ensureWallets(store, options.wallNow);
      for (const error of errors) await store.appendEvent({ id: newId("evt"), at, kind: "payment_failed", actor: "system", text: `Wallet setup failed, sandbox error: ${error}`.slice(0, 240) });
    } catch (error) {
      console.error("wallet setup failed", error instanceof Error ? error.message : "unknown error");
    }
  }
  return { resetCount };
}

// Saves what is in the store as a Replay run.
export async function recordCurrentRun(store: Store, input: { id: string; label: string }, options: Options = {}): Promise<RecordedRun> {
  const run: RecordedRun = { id: input.id, label: input.label, scenario: "shawarma", source: "live", recordedAt: nowIso(options), snapshot: await store.snapshot() };
  await store.saveRecordedRun(run);
  return run;
}
