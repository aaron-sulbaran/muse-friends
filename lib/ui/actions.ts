import type { Category, Role } from "./types";

export type Result = { ok: true } | { ok: false; message: string };

type ErrorBody = { error?: string | { message?: string } | null };

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
    return { ok: false, message: message ?? `Request failed with ${response.status}` };
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
