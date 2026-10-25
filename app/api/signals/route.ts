import { after } from "next/server";
import { z } from "zod";
import { reserveRun, runBudget } from "@/lib/agent/caps";
import { injectSignal, runSignalTurn } from "@/lib/agent/runtime";
import { newId } from "@/lib/agent/ids";
import { httpDeliver } from "@/lib/agent/wire";
import { rawShawarmaSignal } from "@/lib/seed/fixtures";
import { getStore } from "@/lib/store";

// "Lisa sent Aaron a reel": injects the seeded signal and starts the receiving agent's turn after
// responding. Seeded and fictional; the caption is read by Muse Spark live.
//
// Live runs spend Muse credits, so each start is counted against a per-room and a global hourly cap
// (lib/agent/caps.ts). Past either, the answer is 429 { paused: true, text: "Live runs paused, playing a
// recording" }: the room is meant to fall back to Replay. GET returns the counters for the JSON drawer.
export const maxDuration = 300;

const Body = z.strictObject({ scenario: z.literal("shawarma").default("shawarma") });

export async function GET() {
  return Response.json({ budget: runBudget() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const body = Body.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: z.prettifyError(body.error) }, { status: 400 });

  // The public URL spends model credits on every live run. Take a slot first; nothing is started without one.
  const reserved = reserveRun();
  if (!reserved.ok) {
    return Response.json(
      { paused: true, reason: reserved.reason, text: reserved.text, budget: reserved.budget },
      { status: 429, headers: { "Retry-After": String(reserved.budget.retryAfterSeconds ?? 60) } },
    );
  }
  const budget = reserved.budget;
  const store = await getStore();

  const signal = { ...rawShawarmaSignal(), id: newId("sig") };
  const { contextId, planId } = await injectSignal(store, signal);

  const origin = new URL(request.url).origin;
  after(async () => {
    try {
      await runSignalTurn({ store, agent: signal.to, signalId: signal.id, contextId, deliver: httpDeliver(origin, signal.to) });
    } catch (error) {
      console.error("signal turn failed", error);
    }
  });

  return Response.json({ signalId: signal.id, contextId, planId, status: { state: "working" }, budget }, { status: 202 });
}
