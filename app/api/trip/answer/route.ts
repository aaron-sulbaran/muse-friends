import { after, NextResponse } from "next/server";
import { z } from "zod";
import { driveTrip, recordAnswer } from "@/lib/agent/trip";
import { MemberId } from "@/lib/protocol";
import { getStore } from "@/lib/store";
import { modelPlayers } from "@/lib/ui/group-players";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.strictObject({
  planId: z.string().min(1),
  member: MemberId,
  answer: z.enum(["yes", "no", "limit"]),
  limit: z.number().int().optional(),
});

/**
 * A person answers the trip's bounded question from their card: yes, no, or their own limit. The number is theirs and
 * is recorded as such; the member's Muse then tells the coordinator, and the trip moves on (the model-played people
 * answer and the coordinator composes) after this answers.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ data: null, error: { message: "Expected { planId, member, answer: yes, no or limit, limit? }" } }, { status: 400 });
  const store = await getStore();
  const result = await recordAnswer(store, { ...parsed.data, by: "person" });
  if (!result.ok) return NextResponse.json({ data: null, error: { message: result.error } }, { status: result.status });
  after(async () => {
    try {
      await driveTrip(store, parsed.data.planId, modelPlayers);
    } catch (error) {
      console.error("trip drive failed", error);
    }
  });
  return NextResponse.json({ data: { answer: result.answer }, error: null });
}
