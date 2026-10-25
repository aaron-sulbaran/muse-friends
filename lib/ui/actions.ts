import { getRoom, withRoom } from "./room";
import type { Category, MemberId, Role, ShareTier } from "./types";

export type Result = { ok: true } | { ok: false; message: string; paused?: boolean; refused?: boolean; missing?: boolean };

type ErrorBody = { error?: string | { message?: string; code?: string } | null; paused?: boolean; refused?: boolean; text?: string };

async function post(url: string, body: unknown): Promise<Result> {
  try {
    const response = await fetch(withRoom(url, getRoom()), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return { ok: true };
    const payload = (await response.json().catch(() => null)) as ErrorBody | null;
    const error = payload?.error;
    const message = typeof error === "string" ? error : error?.message;
    // A paused budget (429) is not a failure: the page falls back to a recording and says why.
    if (response.status === 429 && payload?.paused === true) return { ok: false, message: payload.text ?? "Live runs paused, playing a recording", paused: true };
    // A route that is not there (a 404 or 405 that is not a room that ran out) is a different thing from a refusal: the caller may carry on and retry.
    const code = typeof error === "object" && error !== null ? error.code : undefined;
    const missing = (response.status === 404 || response.status === 405) && code !== "no_such_room";
    return { ok: false, message: message ?? payload?.text ?? `Request failed with ${response.status}`, ...(payload?.refused === true ? { refused: true } : {}), ...(missing ? { missing: true } : {}) };
  } catch {
    return { ok: false, message: "Could not reach the server" };
  }
}

export function postDecision(planId: string, role: Role, choice: "accept" | "decline") {
  return post(`/api/plans/${planId}/decision`, { role, choice });
}

export function postOutcome(planId: string, role: Role, result: "went" | "didnt"): Promise<Result> {
  return post(`/api/plans/${planId}/outcome`, { role, result });
}

export function postHandoff(planId: string, role: Role, via: "whatsapp" | "copy") {
  return post(`/api/plans/${planId}/draft`, { role, via });
}

/** "The friend sent a reel": starts a real run. The agents take it from here and the Activity timeline fills as they talk. */
export function postSignal() {
  return post("/api/signals", { scenario: "shawarma" });
}

/** "The friend sent a reel" for a plan of three: Sprout's Muse gets Mochi and Pebble together. Same caps and 429 as a pair. */
export function postGroupSignal() {
  return post("/api/signals", { scenario: "group" });
}

/** "Make this happen" for the group chat that never left the chat: Sprout plans a trip months out for three (lib/agent/trip.ts). */
export function postTripSignal() {
  return post("/api/signals", { scenario: "trip" });
}

/** A person answers the trip's bounded question: yes, no, or their own limit in whole dollars. */
export function postTripAnswer(planId: string, member: MemberId, answer: "yes" | "no" | "limit", limit?: number) {
  return post("/api/trip/answer", { planId, member, answer, ...(limit === undefined ? {} : { limit }) });
}

/** A person confirms their own pot deposit and joins ("in"), or passes ("out"). Money moves only on "in". */
export function postTripJoin(planId: string, member: MemberId, choice: "in" | "out") {
  return post("/api/trip/join", { planId, member, choice });
}

/** A person books their own seat on a seeded flight, from their share of the pot and then their trip wallet. */
export function postTripSeat(planId: string, member: MemberId, flight: string) {
  return post("/api/trip/seat", { planId, member, flight });
}

/** A person answers yes or no for the stay on the table; it books only when all three say yes. */
export function postTripHotel(planId: string, member: MemberId, choice: "yes" | "no") {
  return post("/api/trip/hotel", { planId, member, choice });
}

/** Pebble has no phone, so the coordinator's phone answers for them. Any member can be named; the server refuses a second answer. */
export function postMemberDecision(planId: string, member: MemberId, choice: "accept" | "decline") {
  return post(`/api/plans/${planId}/member-decision`, { member, choice });
}

/**
 * The person named someone they met. The gate decides whether Sprout may reach out: a refusal comes back as
 * `refused`, with nothing started, and is shown on the timeline and the phone rather than as an error.
 */
export function postFollowUp(target: string) {
  return post("/api/signals", { scenario: "follow_up", target });
}

/**
 * A lone judge brings in the simulated friend: the room switches over (which clears
 * the stage), then the simulated friend sends the shawarma reel, which starts a real run.
 */
export async function postSimulatedFriend(): Promise<Result> {
  const switched = await postSimulatedFriendSwitch(true);
  if (!switched.ok) return switched;
  return postSignal();
}

/**
 * Michelle on or off for the room, and nothing else. It is a room-level switch and flipping it clears the room, so
 * it is done before a plan starts, or on purpose behind a "start over" the person confirmed.
 */
export function postSimulatedFriendSwitch(on: boolean): Promise<Result> {
  return post("/api/controls", { type: "simulated_friend", on });
}

/** Asks the simulated friend to answer her card. Safe to repeat: the server answers once. */
export function postSimulatedAnswer(planId: string) {
  return post("/api/simulated-friend", { planId });
}

/** Asks the model that plays Kai (the third person of a plan for three) to answer their card. Safe to repeat: the server answers once. */
export function postSimulatedMemberAnswer(planId: string) {
  return post("/api/simulated-member", { planId, member: "kai" });
}

/**
 * "That time doesn't work for me": mark the plan's window busy for this person, then start a new run so the
 * agents plan around it.
 */
export async function postReplan(planId: string, role: Role, followUpTarget?: string): Promise<Result> {
  const marked = await post(`/api/plans/${planId}/busy`, { role });
  if (!marked.ok) return marked;
  // A follow-up has no reel to send again: it starts again with the same person.
  return followUpTarget ? postFollowUp(followUpTarget) : postSignal();
}

/**
 * The person asks their own Muse a question (D31). The answer is not read from this response: it arrives in the next
 * snapshot's `chat`, where the thread and the Activity row pick it up. Only side a has a chat.
 */
export function postChat(text: string) {
  return post("/api/chat", { role: "a", text });
}

/**
 * What a person typed about their week (onboarding's free step): the windows they are free, one line about what they
 * feel like doing, and the name they gave. The server sets that side's calendar and interests for the room; it answers
 * a plain message when a window is not one it can use. Nothing is posted when the person skips the step.
 */
export function postAvailability(input: { side: Role; windows: Array<{ start: string; end: string }>; feels: string | null; name: string | null }) {
  return post("/api/availability", {
    side: input.side,
    windows: input.windows,
    ...(input.feels === null ? {} : { feels: input.feels }),
    ...(AVAILABILITY_TAKES_NAME && input.name !== null && input.name !== "" ? { name: input.name } : {}),
  });
}

/**
 * Whether the availability route takes the person's first name (it lands in the snapshot's `humans`, so the other phone
 * and the thread say it). Lane A's route rejects an unknown key until its name commit is on main: flip this then.
 */
export const AVAILABILITY_TAKES_NAME = false;

export type LeakAttempt = { id: string; label: string; status: number; error: string; rejected: boolean };

/** "Try to leak": asks the server to forge two sends to Mochi's inbox and report what the inbox answered, verbatim. */
export async function postLeakAttempt(): Promise<{ ok: true; attempts: LeakAttempt[] } | { ok: false; message: string }> {
  try {
    const response = await fetch("/api/proof/leak", { method: "POST" });
    const body = (await response.json().catch(() => null)) as { data?: { attempts?: LeakAttempt[] } | null; error?: { message?: string } | null } | null;
    if (response.ok && body?.data?.attempts) return { ok: true, attempts: body.data.attempts };
    return { ok: false, message: body?.error?.message ?? `Request failed with ${response.status}` };
  } catch {
    return { ok: false, message: "Could not reach the server" };
  }
}

/** Asks the person's Muse to settle up for a confirmed plan. The Muse decides whether money moves and how much, within the cap. */
export function postSettle(planId: string, role: Role, note?: string) {
  return post(`/api/plans/${planId}/settle`, note ? { role, note } : { role });
}

/** The person confirms a payment their Muse prepared (D28), at the URL the snapshot gave: the one step that moves money. */
export function postConfirmPayment(confirmUrl: string, role: Role) {
  return post(confirmUrl, { role });
}

/** The person says not now to a payment their Muse prepared: nothing moves, and the friend's Muse is told. */
export function postDeclinePayment(declineUrl: string, role: Role) {
  return post(declineUrl, { role });
}

/** What a seat lets its Muse send: on or off, and a cap per plan in whole dollars (0 to 500; left out keeps the last one). */
export function postPaymentsScope(role: Role, enabled: boolean, cap?: number) {
  return post("/api/controls", { type: "payments", side: role, enabled, ...(cap === undefined ? {} : { cap }) });
}

/** Demo controls (F) move the clock one step; the automatic time skip names the state it saw, so only one phone moves it. */
export function postClockAdvance(from?: "scheduled" | "reminded") {
  return post("/api/clock", from ? { action: "advance", from } : { action: "advance" });
}

export function postReset() {
  return post("/api/controls", { type: "reset" });
}

export type PrivacyChange = { tier: ShareTier } | { category: Category; on: boolean };

/** Side b is the friend's Muse (the avatar sheet); side a is the judge's own (the onboarding's share sheet). */
export function postPrivacy(change: PrivacyChange, side: "a" | "b" = "b") {
  return post("/api/controls", { type: "privacy", side, ...change });
}
