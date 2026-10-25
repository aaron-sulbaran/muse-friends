import type { Role } from "./types";

type Result = { ok: true } | { ok: false; message: string };

async function post(url: string, body: unknown): Promise<Result> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (response.ok) return { ok: true };
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { ok: false, message: payload?.error?.message ?? `Request failed with ${response.status}` };
  } catch {
    return { ok: false, message: "Could not reach the server" };
  }
}

export function postDecision(planId: string, role: Role, choice: "accept" | "decline") {
  return post(`/api/plans/${planId}/decision`, { role, choice });
}

export function postHandoff(planId: string, via: "whatsapp" | "copy") {
  return post(`/api/plans/${planId}/draft`, { via });
}

export type StepAction =
  | { type: "load_reel" }
  | { type: "next_message" }
  | { type: "clock_next" }
  | { type: "set_location"; shared: boolean }
  | { type: "set_simulated"; value: boolean }
  | { type: "set_mode"; mode: "live" | "replay" }
  | { type: "reset" };

/** Drives the recorded run. Goes away when the real signal and clock routes are wired. */
export function postStep(action: StepAction) {
  return post("/api/state/step", action);
}
