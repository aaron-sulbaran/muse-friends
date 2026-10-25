import { after } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { refundRun, reserveRun } from "@/lib/agent/caps";
import { runSettlePreflight, runSettleTurn } from "@/lib/agent/payment-runtime";
import { httpDeliver } from "@/lib/agent/wire";
import { displayName, ROLE_TO_AGENT } from "@/lib/seed/fixtures";
import { getStore } from "@/lib/store";
import { simulatedFriend } from "@/lib/ui/tokens";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.strictObject({
  role: z.enum(["a", "b"]),
  /** What the person said about the money ("I'll cover Mochi's plate"), quoted to the Muse as data. */
  note: z.string().max(200).optional(),
});

function refuse(message: string, status: number) {
  return NextResponse.json({ data: null, error: { message } }, { status });
}

/**
 * A person asks their Muse to settle up for a plan. The Muse decides whether money moves and how much, within the
 * cap the person set; the friend's Muse then accepts it or sends it back. Starts a model turn, so it takes a slot
 * from the same hourly caps as a reel (429 { paused } past them) and answers 202 while the agents work.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/plans/[id]/settle">) {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse("Expected { role: a or b, note? }", 400);
  const store = await getStore();
  const agent = ROLE_TO_AGENT[parsed.data.role];

  const reserved = reserveRun();
  if (!reserved.ok) {
    return NextResponse.json(
      { paused: true, reason: reserved.reason, text: reserved.text, budget: reserved.budget },
      { status: 429, headers: { "Retry-After": String(reserved.budget.retryAfterSeconds ?? 60) } },
    );
  }
  // Refuse what could never pay before spending a model call: payments off, no plan yet.
  const origin = new URL(request.url).origin;
  const refusal = await runSettlePreflight(store, agent, id);
  if (refusal) {
    refundRun();
    // Say the friend the way the Activity feed does: Michelle's Muse, not Mochi's, when the simulated friend plays side b.
    const simulated = agent === "lisa" && (await store.getRoom()).simulatedFriend;
    return refuse(simulated ? refusal.error.replace(`${displayName(agent)}'s Muse`, simulatedFriend.muse) : refusal.error, refusal.status);
  }
  after(async () => {
    try {
      await runSettleTurn({ store, agent, planId: id, note: parsed.data.note, deliver: httpDeliver(origin, agent) });
    } catch (error) {
      console.error("settle turn failed", error instanceof Error ? error.message : "unknown error");
    }
  });
  return NextResponse.json({ data: { planId: id, status: { state: "working" }, budget: reserved.budget }, error: null }, { status: 202 });
}
