import { NextResponse } from "next/server";
import { z } from "zod";
import { advanceClock, currentPlan } from "@/lib/agent/lifecycle";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.literal("advance") });

/**
 * Fast-forward the demo clock: first to the day-of reminder, then to the next
 * day (the lifecycle runs the plan's end in between, so the follow-through is
 * counted once). The UI labels the clock as simulated whenever it has moved.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: { message: "Expected { action: advance }" } }, { status: 400 });
  }
  const store = await getStore();
  const plan = await currentPlan(store);
  const step = plan && (plan.state === "confirmed" || plan.state === "scheduled") ? "reminder" : "next_day";
  const result = await advanceClock(store, { step });
  if (!result.ok) return NextResponse.json({ data: null, error: { message: result.error } }, { status: result.status });
  return NextResponse.json({ data: { now: result.value.clock.now, plan: result.value.plan.state }, error: null });
}
