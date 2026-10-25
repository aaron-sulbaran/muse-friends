import type { Category, Role, ShareTier } from "./types";

export type Result = { ok: true } | { ok: false; message: string; refused?: boolean };

type ErrorBody = { error?: string | { message?: string } | null; refused?: boolean; text?: string };

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
    return { ok: false, message: message ?? payload?.text ?? `Request failed with ${response.status}`, refused: payload?.refused === true };
  } catch {
    return { ok: false, message: "Could not reach the server" };
  }
}

export function postDecision(planId: string, role: Role, choice: "accept" | "decline") {
  return post(`/api/plans/${planId}/decision`, { role, choice });
}

export function postHandoff(planId: string, role: Role, via: "whatsapp" | "copy") {
  return post(`/api/plans/${planId}/draft`, { role, via });
}

/** "The friend sent a reel": starts a real run. The agents take it from here and the Activity timeline fills as they talk. */
export function postSignal() {
  return post("/api/signals", { scenario: "shawarma" });
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
  const switched = await post("/api/controls", { type: "simulated_friend", on: true });
  if (!switched.ok) return switched;
  return postSignal();
}

/** Asks the simulated friend to answer her card. Safe to repeat: the server answers once. */
export function postSimulatedAnswer(planId: string) {
  return post("/api/simulated-friend", { planId });
}

export function postClockAdvance() {
  return post("/api/clock", { action: "advance" });
}

export function postReset() {
  return post("/api/controls", { type: "reset" });
}

export type PrivacyChange = { tier: ShareTier } | { category: Category; on: boolean };

export function postPrivacy(change: PrivacyChange) {
  return post("/api/controls", { type: "privacy", side: "b", ...change });
}
