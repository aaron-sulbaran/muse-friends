import { withRoom, withoutRoom } from "@/app/api/_lib/room";
import { NextResponse } from "next/server";
import { z } from "zod";
import { advanceClock, currentPlan } from "@/lib/agent/lifecycle";

export const dynamic = "force-dynamic";

// `from` is the state the caller saw: the automatic time skip sends it, so of several phones asking at once only
// the first moves the clock and the rest get ok with no change. Demo controls (F) leave it out.
const bodySchema = z.object({ action: z.literal("advance"), from: z.enum(["scheduled", "reminded"]).optional() });

/**
 * Fast-forward the demo clock: first to the day-of reminder, then to the next
 * day (the lifecycle runs the plan's end in between, so the follow-through is
 * counted once). The UI labels the clock as simulated whenever it has moved.
 */
export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(withoutRoom(raw));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: { message: "Expected { action: advance }" } }, { status: 400 });
  }
  return withRoom(request, raw, {}, async (room) => {
    const store = room.store;
    const from = parsed.data.from;
    const plan = await currentPlan(store);
    const seen = from ?? plan?.state;
    const step = seen === "confirmed" || seen === "scheduled" ? "reminder" : "next_day";
    const result = await advanceClock(store, { step, from });
    if (!result.ok) return NextResponse.json({ data: null, error: { message: result.error } }, { status: result.status });
    return NextResponse.json({ data: { now: result.value.clock.now, plan: result.value.plan.state, changed: result.value.changed }, error: null });
  });
}
