import type { ActivityEvent, AgentId, Plan } from "@/lib/protocol";
import { REFUSAL_TEXT, startGate, type RefusalReason } from "@/lib/policy";
import { getContact, type Contact } from "@/lib/seed/contacts";
import { displayName } from "@/lib/seed/fixtures";
import type { Store } from "@/lib/store";
import { transitionPlan } from "@/lib/plans";
import { newId } from "./ids";
import { toCentralIso } from "./windows";

// The weak-tie follow-up: a person names someone they met ("follow up with Jules") and their Muse
// reaches out to that person's Muse. It starts only through this gate: no mutual follow, no thread.
// The contact is always the person's choice; nothing here, and no agent, ever picks one.

const INITIATOR: AgentId = "aaron";

// What each tier means, in fixed copy, for the timeline row that announces it.
const TIER_NOTE: Partial<Record<Contact["tier"], string>> = {
  acquaintance: "interests, food, and free times only, never location",
};

export type FollowUpStart =
  | { ok: false; status: 404; error: string }
  | { ok: true; started: true; contextId: string; planId: string; contact: Contact }
  | { ok: true; started: false; reason: RefusalReason; text: string; planId: string; contact: Contact };

export async function startFollowUp(store: Store, input: { target: string }, options: { wallNow?: () => number } = {}): Promise<FollowUpStart> {
  const contact = getContact(input.target);
  if (!contact) return { ok: false, status: 404, error: "no such contact" };

  const now = options.wallNow?.() ?? Date.now();
  const at = toCentralIso(now);
  const contextId = newId("ctx", now);
  const planId = newId("plan", now);
  const row = (kind: ActivityEvent["kind"], actor: ActivityEvent["actor"], text: string, agent?: AgentId): ActivityEvent => ({
    id: newId("evt", now),
    at,
    kind,
    actor,
    agent,
    contextId,
    planId,
    text,
  });

  const detected: Plan = {
    id: planId,
    contextId,
    initiator: INITIATOR,
    participants: [INITIATOR, contact.agent],
    state: "detected",
    decisions: { aaron: "pending", lisa: "pending" },
    target: contact.id,
    history: [{ state: "detected", at, note: "Follow-up requested" }],
    createdAt: at,
    updatedAt: at,
  };
  const asked = row("signal_received", "human", `${displayName(INITIATOR)} asked to follow up with ${contact.displayName} (${contact.howYouMet.toLowerCase()})`, INITIATOR);

  const gate = startGate(contact);
  if (!gate.ok) {
    // A logged refusal: a dropped plan with a fixed reason code and fixed copy. No thread, no model call.
    const text = REFUSAL_TEXT[gate.reason](contact.displayName);
    const refused = transitionPlan(detected, "dropped", at, { note: gate.reason, dropReason: "policy_blocked" });
    await Promise.all([store.putPlan(refused), store.appendEvent(asked)]);
    await store.appendEvent(row("plan_state", "system", text));
    return { ok: true, started: false, reason: gate.reason, text, planId, contact };
  }

  // Sharing with an acquaintance is capped by the tier, in both directions, for this follow-up.
  const policies = [
    { owner: INITIATOR, friend: contact.agent, tier: contact.tier, categories: {} },
    { owner: contact.agent, friend: INITIATOR, tier: contact.tier, categories: {} },
  ] as const;
  await Promise.all([store.putPlan(detected), store.appendEvent(asked), ...policies.map((policy) => store.putPolicy({ ...policy, categories: {} }))]);
  const note = TIER_NOTE[contact.tier];
  if (note) await store.appendEvent(row("policy_changed", "system", `Sharing with ${contact.displayName} is at the ${contact.tier} level: ${note}`));
  return { ok: true, started: true, contextId, planId, contact };
}
