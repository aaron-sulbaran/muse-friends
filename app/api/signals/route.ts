import { after } from "next/server";
import { z } from "zod";
import { startFollowUp } from "@/lib/agent/followup";
import { injectSignal, runFollowUpTurn, runSignalTurn } from "@/lib/agent/runtime";
import { newId } from "@/lib/agent/ids";
import { httpDeliver } from "@/lib/agent/wire";
import { rawShawarmaSignal } from "@/lib/seed/fixtures";
import { getStore } from "@/lib/store";

// Starts a plan. Two ways in, both seeded and fictional:
//   {} or { scenario: "shawarma" }               "Lisa sent Aaron a reel": injects the reel and starts the
//                                                receiving agent's turn after responding.
//   { scenario: "follow_up", target: "<id>" }    a person names someone they met and their Muse reaches out.
//                                                The contact is the person's choice. It starts only if you
//                                                and the contact follow each other (409 not_mutual otherwise,
//                                                with the refusal logged on the timeline and no thread).
export const maxDuration = 300;

const DEFAULT_MAX_RUNS_PER_ROOM = 40;

const Body = z.union([
  z.strictObject({ scenario: z.literal("shawarma").default("shawarma") }),
  z.strictObject({ scenario: z.literal("follow_up"), target: z.string().min(1).max(40) }),
]);

export async function POST(request: Request) {
  const body = Body.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: z.prettifyError(body.error) }, { status: 400 });

  // The public URL spends model credits on every run: cap runs per room. Reset clears the count.
  const store = await getStore();
  const cap = Number(process.env.MAX_RUNS_PER_ROOM ?? DEFAULT_MAX_RUNS_PER_ROOM);
  const [signals, plans] = await Promise.all([store.listSignals(), store.listPlans()]);
  if (Math.max(signals.length, plans.length) >= cap) {
    return Response.json({ error: `This room has used its ${cap} runs. Reset the demo to start fresh.` }, { status: 429 });
  }

  const origin = new URL(request.url).origin;

  if (body.data.scenario === "follow_up") {
    const started = await startFollowUp(store, { target: body.data.target });
    if (!started.ok) return Response.json({ error: started.error }, { status: started.status });
    if (!started.started) {
      return Response.json({ refused: true, reason: started.reason, text: started.text, contactId: started.contact.id, planId: started.planId }, { status: 409 });
    }
    const { contextId, planId, contact } = started;
    after(async () => {
      try {
        await runFollowUpTurn({ store, agent: "aaron", contact, contextId, deliver: httpDeliver(origin, "aaron") });
      } catch (error) {
        console.error("follow-up turn failed", error);
      }
    });
    return Response.json({ contextId, planId, contactId: contact.id, status: { state: "working" } }, { status: 202 });
  }

  const signal = { ...rawShawarmaSignal(), id: newId("sig") };
  const { contextId, planId } = await injectSignal(store, signal);
  after(async () => {
    try {
      await runSignalTurn({ store, agent: signal.to, signalId: signal.id, contextId, deliver: httpDeliver(origin, signal.to) });
    } catch (error) {
      console.error("signal turn failed", error);
    }
  });

  return Response.json({ signalId: signal.id, contextId, planId, status: { state: "working" } }, { status: 202 });
}
