import { after, NextResponse } from "next/server";
import { z } from "zod";
import { driveTrip } from "@/lib/agent/trip";
import { answerHotel } from "@/lib/agent/trip-booking";
import { MemberId } from "@/lib/protocol";
import { getStore } from "@/lib/store";
import { modelPlayers } from "@/lib/ui/group-players";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.strictObject({ planId: z.string().min(1), member: MemberId, choice: z.enum(["yes", "no"]) });

/**
 * A person answers for the stay Sprout put on the table. It books only when all three say yes, from each person's own trip
 * wallet; a no brings the next-best stay, and a yes that would break the person's own limit is not counted. One answer per
 * person per stay (409 for a second).
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ data: null, error: { message: "Expected { planId, member, choice: yes or no }" } }, { status: 400 });
  const store = await getStore();
  const result = await answerHotel(store, { planId: parsed.data.planId, member: parsed.data.member, choice: parsed.data.choice, by: "person" });
  if (!result.ok) return NextResponse.json({ data: null, error: { message: result.error } }, { status: result.status });
  after(async () => {
    try {
      await driveTrip(store, parsed.data.planId, modelPlayers);
    } catch (error) {
      console.error("trip drive failed", error);
    }
  });
  return NextResponse.json({ data: { plan: result.plan, counted: result.counted }, error: null });
}
