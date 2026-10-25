import type { ActivityEvent, AgentMessage, MessageRecord, Plan, Redaction, Thread } from "@/lib/protocol";
import { catalogItem, TRIP_PEOPLE } from "@/lib/seed/trip";
import { displayName } from "@/lib/seed/fixtures";
import type { Store } from "@/lib/store";
import { newId, seatOf } from "./ids";

// The rules of the trip channel that need the store, in the order a trip goes: how a trip message is checked in the
// receiver's inbox (after the generic identity, seq, turn and policy checks) and how it is committed. Plans are never
// moved by a message: the trip engine (trip.ts) moves the plan, and a message is the record of what was said.

type Check = { ok: true } | { ok: false; status: 403 | 409 | 422; error: string };

const refuse = (error: string, status: 409 | 422 = 422): Check => ({ ok: false, status, error });

/** The members whose answers the coordinator needs before it can propose anything. */
export function answeredByAll(plan: Plan): boolean {
  return plan.group !== undefined && plan.group.members.every((member) => plan.trip?.answers[member] !== undefined);
}

export async function validateTripIncoming(store: Store, message: AgentMessage): Promise<Check> {
  const trip = message.trip;
  if (!trip) return refuse("a trip message needs a trip payload");
  const plan = await store.getPlan(trip.planId);
  if (!plan?.trip || !plan.group || plan.kind !== "trip") return refuse("the message names a trip plan that does not exist");
  const group = plan.group;
  if (plan.state === "dropped") return refuse("this trip was dropped", 409);

  // The star: the coordinator talks to each member, a member only to the coordinator, on the member's own thread.
  const fromCoordinator = message.from === group.coordinator;
  const member = fromCoordinator ? message.to : message.from;
  const other = fromCoordinator ? message.from : message.to;
  if (other !== group.coordinator || member === group.coordinator || !group.members.includes(member)) return refuse("a trip message goes between the coordinator and one member");
  if (group.contexts[member] !== message.contextId) return refuse("the message is not on that member's trip thread");
  const coordinatorSends = message.type === "trip_ask" || message.type === "trip_plan";
  if (coordinatorSends !== fromCoordinator) return refuse(`only the ${coordinatorSends ? "coordinator" : "member"} sends ${message.type}`);

  const state = plan.trip;
  if (message.type === "trip_ask") {
    if (trip.range?.low !== state.range.low || trip.range?.high !== state.range.high) return refuse("the question names a different range than the trip's");
    return { ok: true };
  }

  if (message.type === "trip_answer") {
    const answer = state.answers[member];
    // The number is the person's: it has to be the answer already recorded for this member, never a new one.
    if (!answer) return refuse("this member's person has not answered yet");
    if (answer.limit !== trip.limit || answer.answer !== trip.answer || answer.taste !== trip.taste || answer.by !== trip.by) return refuse("the answer is not the one the person gave");
    return { ok: true };
  }

  if (message.type === "trip_plan") {
    if (!answeredByAll(plan) || !state.cap || !state.itinerary || !state.pot) return refuse("the plan needs every person's answer, a cap and an itinerary first", 409);
    if (trip.cap !== state.cap.amount || trip.total !== state.itinerary.total || trip.deposit !== state.pot.perPerson) return refuse("the plan does not match the trip's cap, total and deposit");
    const ids = state.itinerary.lines.map((line) => line.id);
    if (JSON.stringify(trip.lines) !== JSON.stringify(ids)) return refuse("the plan lists lines that are not the itinerary's");
    if (!ids.every((id) => catalogItem(id))) return refuse("a line is not in the seeded catalog");
    return { ok: true };
  }

  // trip_reply
  const deposit = state.pot?.deposits[member];
  if (trip.choice === "in") {
    if (!deposit || deposit.status !== "confirmed" || deposit.depositId !== trip.ledgerRef || deposit.amount !== trip.deposit) return refuse("the person has not put that deposit in the pot");
  } else if (deposit?.status === "confirmed") {
    return refuse("this person already put money in the pot, so they cannot be out");
  }
  return { ok: true };
}

const money = (amount: number) => `$${amount.toLocaleString("en-US")}`;

function describeTrip(message: AgentMessage): string {
  const trip = message.trip!;
  const from = displayName(message.from);
  const to = displayName(message.to);
  const person = (member: AgentMessage["from"]) => TRIP_PEOPLE[member].name;
  switch (message.type) {
    case "trip_ask":
      return `${from} asked ${to} for ${person(message.to)}'s budget bound and one taste`;
    case "trip_answer": {
      const how = trip.by === "person" ? "" : trip.by === "seed" ? " (seeded answer)" : " (played by a model)";
      return `${from} answered for ${person(message.from)}${how}: up to ${money(trip.limit ?? 0)}, ${trip.taste}${trip.constraint ? `, ${trip.constraint}` : ""}`;
    }
    case "trip_plan":
      return `${from} proposed a ${money(trip.cap ?? 0)} cap, an itinerary of ${trip.lines?.length ?? 0} lines (seeded) and a ${money(trip.deposit ?? 0)} pot deposit to ${to}`;
    default:
      return trip.choice === "in" ? `${from}: ${person(message.from)} is in, ${money(trip.deposit ?? 0)} in the pot` : `${from}: ${person(message.from)} is out`;
  }
}

// Commits a trip message: the message, a thread of its own linked to the plan and its group, and one timeline row.
// Same shape as commitMessageCore's result, so the inbox treats it like any other.
export async function commitTripCore(store: Store, record: MessageRecord, redaction: Redaction | null = null) {
  const { message } = record;
  const trip = message.trip!;
  const plan = await store.getPlan(trip.planId);
  const existing = await store.getThread(message.contextId);
  const thread: Thread = existing ?? {
    contextId: message.contextId,
    planId: trip.planId,
    groupId: plan?.group?.groupId,
    initiator: message.from,
    participants: [message.from, message.to],
    state: "working",
    messageCount: 0,
    createdAt: message.at,
    updatedAt: message.at,
  };
  const row = (kind: ActivityEvent["kind"], actor: ActivityEvent["actor"], text: string, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({
    id: newId("evt"),
    at: message.at,
    kind,
    actor,
    agent: seatOf(message.from),
    contextId: message.contextId,
    planId: trip.planId,
    messageId: message.id,
    text: text.slice(0, 240),
    ...extra,
  });
  const events: ActivityEvent[] = [row("message_sent", "agent", describeTrip(message))];
  if (redaction) {
    events.push(row("redaction", "system", `Policy removed ${redaction.removed.join(", ")} from ${displayName(message.from)}'s ${message.type}`, { redactionId: redaction.id }));
  }
  await Promise.all([store.appendMessage(record), store.putThread({ ...thread, state: message.state, messageCount: Math.max(thread.messageCount, message.seq), updatedAt: message.at })]);
  const finish = async () => {
    if (redaction) await store.appendRedaction(redaction);
    for (const entry of events) await store.appendEvent(entry);
  };
  return { threadState: message.state, capped: false, finish };
}
