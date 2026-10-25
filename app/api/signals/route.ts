import { after } from "next/server";
import { z } from "zod";
import { injectSignal, runSignalTurn } from "@/lib/agent/runtime";
import { newId } from "@/lib/agent/ids";
import { httpDeliver } from "@/lib/agent/wire";
import { rawShawarmaSignal } from "@/lib/seed/fixtures";
import { getStore } from "@/lib/store";

// "Lisa sent Aaron a reel": injects the seeded signal and starts the receiving agent's turn after
// responding. Seeded and fictional; the caption is read by Muse Spark live.
export const maxDuration = 300;

const DEFAULT_MAX_RUNS_PER_ROOM = 40;

const Body = z.strictObject({ scenario: z.literal("shawarma").default("shawarma") });

export async function POST(request: Request) {
  const body = Body.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: z.prettifyError(body.error) }, { status: 400 });

  // The public URL spends model credits on every run: cap runs per room. Reset clears the count.
  const store = await getStore();
  const cap = Number(process.env.MAX_RUNS_PER_ROOM ?? DEFAULT_MAX_RUNS_PER_ROOM);
  if ((await store.listSignals()).length >= cap) {
    return Response.json({ error: `This room has used its ${cap} runs. Reset the demo to start fresh.` }, { status: 429 });
  }

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

  return Response.json({ signalId: signal.id, contextId, planId, status: { state: "working" } }, { status: 202 });
}
