import { after } from "next/server";
import { z } from "zod";
import { refundRun, reserveRun, runBudget } from "@/lib/agent/caps";
import { startFollowUp } from "@/lib/agent/followup";
import { injectSignal, runFollowUpTurn, runSignalTurn } from "@/lib/agent/runtime";
import { newId } from "@/lib/agent/ids";
import { httpDeliver } from "@/lib/agent/wire";
import { getLiveReel } from "@/lib/instagram";
import type { Signal } from "@/lib/protocol";
import { rawShawarmaSignal } from "@/lib/seed/fixtures";
import { getStore } from "@/lib/store";

// Starts a plan. Two ways in, seeded by default:
//   {} or { scenario: "shawarma" }               "Lisa sent Aaron a reel": injects the reel and starts the
//                                                receiving agent's turn after responding. The reel is read live
//                                                from its owner's Instagram (lib/instagram.ts) when a token is
//                                                set, else the seeded, fictional one; either way the caption is
//                                                read by Muse Spark live.
//   { scenario: "follow_up", target: "<id>" }    a person names someone they met and their Muse reaches out.
//                                                The contact is the person's choice. It starts only if you
//                                                and the contact follow each other (409 not_mutual otherwise,
//                                                with the refusal logged on the timeline and no thread).
//
// Live runs spend Muse credits, so each start is counted against a per-room and a global hourly cap
// (lib/agent/caps.ts). Past either, the answer is 429 { paused: true, text: "Live runs paused, playing a
// recording" }: the room is meant to fall back to Replay. A start that writes nothing (an unknown contact) gives its slot back; a refusal keeps it.
// GET returns the counters for the JSON drawer.
export const maxDuration = 300;

const Body = z.union([
  z.strictObject({ scenario: z.literal("shawarma").default("shawarma") }),
  z.strictObject({ scenario: z.literal("follow_up"), target: z.string().min(1).max(40) }),
]);

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

  const origin = new URL(request.url).origin;

  if (body.data.scenario === "follow_up") {
    const started = await startFollowUp(store, { target: body.data.target });
    if (!started.ok) {
      // Nothing was written or started (an unknown contact), so the slot goes back.
      refundRun();
      return Response.json({ error: started.error }, { status: started.status });
    }
    if (!started.started) {
      // The gate refused: no model call, but the refusal writes a plan and timeline rows, so it keeps its slot.
      // A public URL cannot be used to flood the store with refusals.
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
    return Response.json({ contextId, planId, contactId: contact.id, status: { state: "working" }, budget }, { status: 202 });
  }

  const seeded = rawShawarmaSignal();
  const live = await getLiveReel();
  const signal: Signal = live
    ? {
        ...seeded,
        id: newId("sig"),
        media: live,
        provenance: {
          source: "instagram_graph_api",
          shapedLike: "Instagram Graph API media fields",
          fictional: false,
          note: "Read live through the Instagram Graph API from the reel owner's own account, with their consent.",
        },
      }
    : { ...seeded, id: newId("sig") };
  const { contextId, planId } = await injectSignal(store, signal);
  after(async () => {
    try {
      await runSignalTurn({ store, agent: signal.to, signalId: signal.id, contextId, deliver: httpDeliver(origin, signal.to) });
    } catch (error) {
      console.error("signal turn failed", error);
    }
  });

  return Response.json({ signalId: signal.id, contextId, planId, status: { state: "working" }, budget }, { status: 202 });
}
