import {
  type ActivityEvent,
  type AgentId,
  type AgentMessage,
  type DropReason,
  type MessageRecord,
  type Plan,
  type Recommendation,
  type Redaction,
  type Thread,
} from "@/lib/protocol";
import { displayName } from "@/lib/seed/fixtures";
import { canTransition, transitionPlan } from "@/lib/plans";
import type { Store } from "@/lib/store";
import { toCentralIso, windowHash, describeWindow } from "./windows";
import { buildCards } from "./cards";
import { newId } from "./ids";
import { passedOver } from "./thread";

// Committing a message is the receiving side of the wire: it persists the message, advances the
// thread and plan, keeps the rejected-window ledger, and writes the timeline rows. The inbox route
// calls it after validateIncoming; the local delivery path calls it directly.

export function messageEventText(message: AgentMessage): string {
  const windows = message.windows?.map(describeWindow).join(", ");
  return `${displayName(message.from)} sent ${message.type}${windows ? `: ${windows}` : ""}`;
}

async function ensurePlan(store: Store, message: AgentMessage, at: string): Promise<Plan> {
  const existing = await store.getPlanByContext(message.contextId);
  if (existing) return existing;
  const plan: Plan = {
    id: newId("plan"),
    contextId: message.contextId,
    initiator: message.from,
    participants: [message.from, message.to],
    state: "detected",
    decisions: { aaron: "pending", lisa: "pending" },
    history: [{ state: "detected", at }],
    createdAt: at,
    updatedAt: at,
  };
  await store.putPlan(plan);
  return plan;
}

export async function commitMessage(store: Store, record: MessageRecord, redaction: Redaction | null = null): Promise<void> {
  const { message } = record;
  const at = message.at;
  const plan = await ensurePlan(store, message, at);
  const prior = (await store.listMessages(message.contextId)).map((entry) => entry.message);

  let thread = await store.getThread(message.contextId);
  const opening = thread === null;
  thread ??= {
    contextId: message.contextId,
    planId: plan.id,
    initiator: message.from,
    participants: [message.from, message.to],
    state: "working",
    messageCount: 0,
    createdAt: at,
    updatedAt: at,
  } satisfies Thread;

  await store.appendMessage(record);
  if (redaction) await store.appendRedaction(redaction);

  const events: ActivityEvent[] = [];
  const event = (kind: ActivityEvent["kind"], actor: ActivityEvent["actor"], text: string, extra: Partial<ActivityEvent> = {}) =>
    events.push({ id: newId("evt"), at, kind, actor, contextId: message.contextId, planId: plan.id, agent: message.from, text, ...extra });

  let nextPlan = plan;
  let cards: Recommendation[] = [];
  if (opening) {
    nextPlan = transitionPlan(nextPlan, "negotiating", at);
    event("thread_opened", "agent", `${displayName(message.from)} opened a thread with ${displayName(message.to)}`);
  }
  event("message_sent", "agent", messageEventText(message), { messageId: message.id });
  if (redaction) {
    event("redaction", "system", `Policy removed ${redaction.removed.join(", ")} from ${displayName(message.from)}'s ${message.type}`, {
      messageId: message.id,
      redactionId: redaction.id,
    });
  }

  // The ledger remembers windows that were offered and then passed over.
  const friendLast = [...prior].reverse().find((entry) => entry.from !== message.from);
  for (const window of passedOver(friendLast?.windows, message.windows)) {
    await store.addRejectedWindow(message.contextId, windowHash(window));
  }

  const dropReason: DropReason | undefined = message.state === "rejected" ? (message.reason === "no_overlap" ? "no_overlap" : "declined") : undefined;
  if (message.state === "input-required" && nextPlan.state === "negotiating") {
    nextPlan = {
      ...transitionPlan(nextPlan, "awaiting_humans", at, { note: "Both agents accepted" }),
      activity: message.activity ?? prior.find((entry) => entry.activity)?.activity,
      window: message.windows?.[0],
    };
    event("plan_state", "system", `${displayName(message.from)} and ${displayName(message.to)} agreed on ${message.windows?.[0] ? describeWindow(message.windows[0]) : "a time"}. Waiting on both people.`, { agent: undefined });
    nextPlan = { ...nextPlan, draft: buildCards(nextPlan, at).find((card) => card.draft)?.draft };
    cards = buildCards(nextPlan, at);
    for (const card of cards) {
      event("card_created", "agent", `Card for ${displayName(card.forAgent)}: ${card.forAgent === nextPlan.initiator ? `reach out to ${displayName(card.friend)}` : `${displayName(card.friend)} is about to reach out`}`, { agent: card.forAgent });
    }
  } else if (message.state === "rejected" && nextPlan.state === "negotiating") {
    nextPlan = transitionPlan(nextPlan, "dropped", at, { note: "A decline ended the thread", dropReason });
    event("plan_state", "system", "Plan dropped: the thread ended in a decline", { agent: undefined });
  }

  await store.putThread({ ...thread, state: message.state, messageCount: Math.max(thread.messageCount, message.seq), dropReason, updatedAt: at });
  await store.putPlan(nextPlan);
  for (const card of cards) await store.putCard(card);
  for (const row of events) await store.appendEvent(row);
}

// A turn that could not produce a valid message ends the thread as failed, with the reason on screen.
export async function failThread(store: Store, contextId: string, agent: AgentId, detail: string, wallNow: number = Date.now()): Promise<void> {
  const at = toCentralIso(wallNow);
  const thread = await store.getThread(contextId);
  const plan = await store.getPlanByContext(contextId);
  if (thread) await store.putThread({ ...thread, state: "failed", dropReason: "cap_reached", updatedAt: at });
  if (plan && canTransition(plan.state, "dropped")) {
    await store.putPlan(transitionPlan(plan, "dropped", at, { note: detail, dropReason: "cap_reached" }));
  }
  await store.appendEvent({
    id: newId("evt"),
    at,
    kind: "turn_failed",
    actor: "system",
    agent,
    contextId,
    planId: plan?.id,
    text: `${displayName(agent)}'s turn ended without a message (${detail}); the thread is marked failed`,
  });
}
