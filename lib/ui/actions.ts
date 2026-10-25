import { getRoom, withRoom } from "./room";
import type { Category, Role } from "./types";

export type Result = { ok: true } | { ok: false; message: string; paused?: boolean };

type ErrorBody = { error?: string | { message?: string } | null; paused?: boolean; text?: string };

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
    return { ok: false, message: message ?? `Request failed with ${response.status}` };
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

/**
 * "That time doesn't work for me": mark the plan's window busy for this person, then start a new run so the
 * agents plan around it.
 */
export async function postReplan(planId: string, role: Role): Promise<Result> {
  const marked = await post(`/api/plans/${planId}/busy`, { role });
  if (!marked.ok) return marked;
  return postSignal();
}

/**
 * The person asks their own Muse a question (D31). The answer is not read from this response: it arrives in the next
 * snapshot's `chat`, where the thread and the Activity row pick it up. Only side a has a chat.
 */
export function postChat(text: string) {
  return post("/api/chat", { role: "a", text });
}

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

export function postClockAdvance() {
  return post("/api/clock", { action: "advance" });
}

export function postReset() {
  return post("/api/controls", { type: "reset" });
}

export type PrivacyChange = { tier: "close" | "friend" | "off" } | { category: Category; on: boolean };

/** Side b is the friend's Muse (the avatar sheet); side a is the judge's own (the onboarding's share sheet). */
export function postPrivacy(change: PrivacyChange, side: "a" | "b" = "b") {
  return post("/api/controls", { type: "privacy", side, ...change });
}
