import {
  THREAD_CAP,
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

export type CommitResult = {
  // The state the thread is in after this message ("failed" when the cap ended it).
  threadState: Thread["state"];
  // True when this was the sixth message and the agents still had not agreed: the plan is dropped.
  capped: boolean;
  // Everything the receiving agent's next turn and the Activity timeline need that the 202 does not:
  // the redaction record, the rejected-window ledger, and the timeline rows. Await it before running
  // the turn (the inbox does so in after()).
  finish: () => Promise<void>;
};

// Persists the part of a message that has to exist before anyone is told it arrived: the message, the
// thread, the plan (with the cards when the agents just agreed). These writes are independent, so they
// go out together, and the whole step costs one store round trip however slow the store is. The rest
// comes back as `finish`, so an inbox can answer 202 first.
export async function commitMessageCore(store: Store, record: MessageRecord, redaction: Redaction | null = null): Promise<CommitResult> {
  const { message } = record;
  const at = message.at;
  const [existingPlan, priorRecords, existingThread] = await Promise.all([
    store.getPlanByContext(message.contextId),
    store.listMessages(message.contextId),
    store.getThread(message.contextId),
  ]);
  const plan = existingPlan ?? (await createPlan(store, message, at));
  const prior = priorRecords.map((entry) => entry.message);

  const opening = existingThread === null;
  const thread: Thread =
    existingThread ??
    ({
      contextId: message.contextId,
      planId: plan.id,
      initiator: message.from,
      participants: [message.from, message.to],
      state: "working",
      messageCount: 0,
      createdAt: at,
      updatedAt: at,
    } satisfies Thread);

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
  const passed = passedOver(friendLast?.windows, message.windows).map(windowHash);

  const dropReason: DropReason | undefined = message.state === "rejected" ? (message.reason === "no_overlap" ? "no_overlap" : "declined") : undefined;
  const capped = message.seq >= THREAD_CAP && message.state === "working";
  let threadState: Thread["state"] = message.state;
  let threadDropReason: DropReason | undefined = dropReason;

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
  } else if (capped && canTransition(nextPlan.state, "dropped")) {
    // The conversation used all its messages without both agents accepting: it ends here, on the timeline.
    threadState = "failed";
    threadDropReason = "cap_reached";
    nextPlan = transitionPlan(nextPlan, "dropped", at, { note: `No agreement within ${THREAD_CAP} messages`, dropReason: "cap_reached" });
    event("plan_state", "system", `Plan dropped: no agreement within ${THREAD_CAP} messages (cap reached)`, { agent: undefined });
  }

  await Promise.all([
    store.appendMessage(record),
    store.putThread({ ...thread, state: threadState, messageCount: Math.max(thread.messageCount, message.seq), dropReason: threadDropReason, updatedAt: at }),
    store.putPlan(nextPlan),
    ...cards.map((card) => store.putCard(card)),
  ]);

  const finish = async () => {
    await Promise.all([...(redaction ? [store.appendRedaction(redaction)] : []), ...passed.map((hash) => store.addRejectedWindow(message.contextId, hash))]);
    // Timeline rows go in order, one after another, so the Activity view reads the way it happened.
    for (const row of events) await store.appendEvent(row);
  };
  return { threadState, capped, finish };
}

// The whole commit, finished before returning: for the in-process delivery path and tests.
export async function commitMessage(store: Store, record: MessageRecord, redaction: Redaction | null = null): Promise<CommitResult> {
  const result = await commitMessageCore(store, record, redaction);
  await result.finish();
  return result;
}

async function createPlan(store: Store, message: AgentMessage, at: string): Promise<Plan> {
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
    text: `${displayName(agent)}'s turn ended without a message (${detail}); the thread is marked failed and the plan dropped with reason cap_reached`,
  });
}
