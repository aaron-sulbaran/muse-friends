import { z } from "zod";
import { chooseRoom, converse, withRoom, withoutRoom } from "@/app/api/_lib/room";
import { refundRun, reserveRun, runBudget } from "@/lib/agent/caps";
import { startFollowUp } from "@/lib/agent/followup";
import { startGroup } from "@/lib/agent/group";
import { driveTrip, startTrip } from "@/lib/agent/trip";
import { injectSignal, runFollowUpTurn, runSignalTurn } from "@/lib/agent/runtime";
import { newId } from "@/lib/agent/ids";
import { getLiveReel } from "@/lib/instagram";
import type { Signal } from "@/lib/protocol";
import { rawShawarmaSignal } from "@/lib/seed/fixtures";
import { modelPlayers } from "@/lib/ui/group-players";

// Starts a plan. Three ways in, seeded by default:
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
//
// scenario "group" is the same reel, but Sprout makes it a plan for three (Mochi and Pebble): one pair thread per
// friend, the protocol unchanged, a groupId on each thread, one plan with a group on it.
//
// scenario "trip" is a plan for three months out (Plan.kind "trip"): no reel, the group chat that never made it out of
// the chat. Sprout asks each Muse a bounded question; a model plays the people who are not in the room (lib/agent/trip.ts).
//
// Rooms: `?room=<id>` (or `room` in the body) names a phone's own room (app/api/_lib/room.ts); no room, or "demo", is the
// demo room exactly as before. A room runs the shawarma plan and a follow-up with the agents in this process; the plan
// of three and the trip are the demo room's for now (409 in a room).
export const maxDuration = 300;

const Body = z.union([
  z.strictObject({ scenario: z.enum(["shawarma", "group", "trip"]).default("shawarma") }),
  z.strictObject({ scenario: z.literal("follow_up"), target: z.string().min(1).max(40) }),
]);

export async function GET() {
  return Response.json({ budget: runBudget() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const raw = await request.json().catch(() => ({}));
  const body = Body.safeParse(withoutRoom(raw));
  if (!body.success) return Response.json({ error: z.prettifyError(body.error) }, { status: 400 });

  // A coordinator with three seats, and the trip's model-played people, are not run in a phone room yet. Refused before
  // a room is made, so a refusal costs no room.
  if ((body.data.scenario === "group" || body.data.scenario === "trip") && chooseRoom(request, raw).kind === "phone") {
    return Response.json({ error: `A ${body.data.scenario === "trip" ? "trip" : "plan for three"} runs in the demo room for now, not in a phone room.` }, { status: 409 });
  }

  return withRoom(request, raw, { mint: true }, async (room) => {
    // The public URL spends model credits on every live run. Take a slot first; nothing is started without one.
    const reserved = reserveRun(room.id);
    if (!reserved.ok) {
      return Response.json(
        { paused: true, reason: reserved.reason, text: reserved.text, budget: reserved.budget },
        { status: 429, headers: { "Retry-After": String(reserved.budget.retryAfterSeconds ?? 60) } },
      );
    }
    const budget = reserved.budget;
    const store = room.store;

    const origin = new URL(request.url).origin;

    if (body.data.scenario === "follow_up") {
      const started = await startFollowUp(store, { target: body.data.target });
      if (!started.ok) {
        // Nothing was written or started (an unknown contact), so the slot goes back.
        refundRun(room.id);
        return Response.json({ error: started.error }, { status: started.status });
      }
      if (!started.started) {
        // The gate refused: no model call, but the refusal writes a plan and timeline rows, so it keeps its slot.
        // A public URL cannot be used to flood the store with refusals.
        return Response.json({ refused: true, reason: started.reason, text: started.text, contactId: started.contact.id, planId: started.planId }, { status: 409 });
      }
      const { contextId, planId, contact } = started;
      room.background(async (scope) => {
        try {
          await converse(scope, contextId, () => runFollowUpTurn({ store: scope.store, agent: "aaron", contact, contextId, deliver: scope.deliver(origin, "aaron") }));
        } catch (error) {
          console.error("follow-up turn failed", error);
        }
      });
      return Response.json({ contextId, planId, contactId: contact.id, status: { state: "working" }, budget }, { status: 202 });
    }

    if (body.data.scenario === "trip") {
      const started = await startTrip(store);
      room.background(async (scope) => {
        try {
          await driveTrip(scope.store, started.planId, modelPlayers);
        } catch (error) {
          console.error("trip failed", error);
        }
      });
      return Response.json(
        { contextId: started.firstContextId, planId: started.planId, groupId: started.groupId, contexts: started.contexts, status: { state: "working" }, budget },
        { status: 202 },
      );
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

    if (body.data.scenario === "group") {
      const started = await startGroup(store, signal);
      const group = (await store.getPlan(started.planId))?.group;
      room.background(async (scope) => {
        try {
          await runSignalTurn({ store: scope.store, agent: signal.to, signalId: signal.id, contextId: started.firstContextId, group, deliver: scope.deliver(origin, signal.to) });
        } catch (error) {
          console.error("group signal turn failed", error);
        }
      });
      return Response.json(
        { signalId: signal.id, contextId: started.firstContextId, planId: started.planId, groupId: started.groupId, contexts: started.contexts, status: { state: "working" }, budget },
        { status: 202 },
      );
    }

    const { contextId, planId } = await injectSignal(store, signal);
    room.background(async (scope) => {
      try {
        await converse(scope, contextId, () => runSignalTurn({ store: scope.store, agent: signal.to, signalId: signal.id, contextId, deliver: scope.deliver(origin, signal.to) }));
      } catch (error) {
        console.error("signal turn failed", error);
      }
    });

    return Response.json({ signalId: signal.id, contextId, planId, status: { state: "working" }, budget }, { status: 202 });
  });
}
