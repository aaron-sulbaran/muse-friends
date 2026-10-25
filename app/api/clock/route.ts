import { NextResponse } from "next/server";
import { z } from "zod";
import { dispatch, readSnapshot } from "@/lib/ui/source";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.literal("advance") });

/**
 * Fast-forward the demo clock: first to the day-of reminder, then to the next
 * day. The UI labels the clock as simulated whenever it has moved.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: { message: "Expected { action: advance }" } }, { status: 400 });
  }
  const before = readSnapshot().plan;
  if (!before || !["confirmed", "scheduled", "reminded"].includes(before.state)) {
    return NextResponse.json(
      { data: null, error: { message: "The clock moves once both people have said yes, and stops after the follow-up" } },
      { status: 409 },
    );
  }
  const after = dispatch({ type: "clock_next" });
  return NextResponse.json({ data: { now: after.now, plan: after.plan?.state ?? null }, error: null });
}
