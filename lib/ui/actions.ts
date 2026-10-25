import type { Category, MemberId, Role } from "./types";

export type Result = { ok: true } | { ok: false; message: string; paused?: boolean };

type ErrorBody = { error?: string | { message?: string } | null; paused?: boolean; text?: string };

async function post(url: string, body: unknown): Promise<Result> {
  try {
    const response = await fetch(url, {
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

/** "The friend sent a reel" for a plan of three: Sprout's Muse gets Mochi and Pebble together. Same caps and 429 as a pair. */
export function postGroupSignal() {
  return post("/api/signals", { scenario: "group" });
}

/** Pebble has no phone, so the coordinator's phone answers for them. Any member can be named; the server refuses a second answer. */
export function postMemberDecision(planId: string, member: MemberId, choice: "accept" | "decline") {
  return post(`/api/plans/${planId}/member-decision`, { member, choice });
}

/**
 * A lone judge brings in the simulated friend: the room switches over (which clears
 * the stage), then the simulated friend sends the shawarma reel, which starts a real run.
 */
export async function postSimulatedFriend(): Promise<Result> {
  const switched = await post("/api/controls", { type: "simulated_friend", on: true });
  if (!switched.ok) return switched;
  return postSignal();
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

export function postClockAdvance() {
  return post("/api/clock", { action: "advance" });
}

export function postReset() {
  return post("/api/controls", { type: "reset" });
}

export type PrivacyChange = { tier: "close" | "friend" | "off" } | { category: Category; on: boolean };

export function postPrivacy(change: PrivacyChange) {
  return post("/api/controls", { type: "privacy", side: "b", ...change });
}
