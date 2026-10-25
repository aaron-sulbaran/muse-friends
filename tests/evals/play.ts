import { resetDemo } from "@/lib/agent/controls";
import { resetRunBudget } from "@/lib/agent/caps";
import { injectSignal } from "@/lib/agent/runtime";
import type { Plan } from "@/lib/protocol";
import { rawShawarmaSignal } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import { afterQueue, ORIGIN } from "../live/helpers/scenario";

// Driving the app for the evals: the real route handlers, in process, on a fresh JSON store each run, with next's
// after() queued and drained one step at a time (the same wiring as `pnpm demo:run`). Nothing here can reach
// production: the store is in memory, the origin is a name no network resolves, and the key is only for the model.

export { ORIGIN };

type Holder = { __museStore?: Promise<JsonStore> };

// A new room: an empty in-memory store, the seed, the wallets, and the hourly run counter back at zero (each run is
// its own room, so the counter that guards the public URL starts clean).
export async function newRoom(options: { simulatedFriend?: boolean } = {}): Promise<JsonStore> {
  const store = new JsonStore(null);
  (globalThis as Holder).__museStore = Promise.resolve(store);
  resetRunBudget();
  afterQueue().length = 0;
  await resetDemo(store, { simulatedFriend: options.simulatedFriend ?? false });
  return store;
}

export function closeRoom(): void {
  (globalThis as Holder).__museStore = undefined;
  afterQueue().length = 0;
}

// Runs every queued step, each of which may queue the next.
export async function drain(): Promise<void> {
  const queue = afterQueue();
  while (queue.length > 0) await queue.shift()!();
}

export async function post(route: () => Promise<{ POST: (request: Request, context: never) => Promise<Response> }>, path: string, body: unknown, context?: unknown): Promise<{ status: number; json: unknown }> {
  const { POST } = await route();
  const response = await POST(new Request(`${ORIGIN}${path}`, { method: "POST", body: JSON.stringify(body) }), context as never);
  return { status: response.status, json: await response.json().catch(() => null) };
}

// The reel arrives through the real signals route and the agents talk until nothing is left to run.
export async function startReel(): Promise<{ status: number; planId: string; contextId: string }> {
  const { status, json } = await post(() => import("@/app/api/signals/route"), "/api/signals", {});
  const { planId, contextId } = (json ?? {}) as { planId: string; contextId: string };
  await drain();
  return { status, planId, contextId };
}

// A plan the people have already confirmed, without a negotiation: for the scenarios about money, so a payment
// turn is the only model work in the run.
export async function confirmedPlan(store: JsonStore): Promise<Plan> {
  const { planId } = await injectSignal(store, { ...rawShawarmaSignal(), id: "sig_eval" });
  const base = (await store.getPlan(planId))!;
  const plan: Plan = {
    ...base,
    state: "confirmed",
    activity: { kind: "food", title: "Shawarma Point", place: "E 6th St" },
    window: { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" },
    decisions: { aaron: "accepted", lisa: "accepted" },
  };
  await store.putPlan(plan);
  return plan;
}

// Runs `work` with the model pointed at a model that does not exist, so every call is a 404, and puts the
// environment back after. The retry pauses are shrunk so an outage run is quick.
export async function withModelOutage<T>(work: () => Promise<T>): Promise<T> {
  const before = { id: process.env.MODEL_ID, scale: process.env.MODEL_RETRY_SCALE };
  process.env.MODEL_ID = "muse-eval-model-that-does-not-exist";
  process.env.MODEL_RETRY_SCALE = "0.02";
  try {
    return await work();
  } finally {
    if (before.id === undefined) delete process.env.MODEL_ID;
    else process.env.MODEL_ID = before.id;
    if (before.scale === undefined) delete process.env.MODEL_RETRY_SCALE;
    else process.env.MODEL_RETRY_SCALE = before.scale;
  }
}
