import { after, NextResponse } from "next/server";
import { z } from "zod";
import { confirmJoin, declineJoin, driveTrip } from "@/lib/agent/trip";
import { MemberId } from "@/lib/protocol";
import { getStore } from "@/lib/store";
import { modelPlayers } from "@/lib/ui/group-players";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.strictObject({ planId: z.string().min(1), member: MemberId, choice: z.enum(["in", "out"]) });

/**
 * A person confirms their own deposit and joins the trip ("in"), or passes ("out"). Money moves from their seeded trip
 * wallet into the pot only on "in", paper dollars on the demo's local ledger; "out" moves nothing and drops the plan.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ data: null, error: { message: "Expected { planId, member, choice: in or out }" } }, { status: 400 });
  const store = await getStore();
  const input = { planId: parsed.data.planId, member: parsed.data.member };
  const result = parsed.data.choice === "in" ? await confirmJoin(store, input) : await declineJoin(store, input);
  if (!result.ok) return NextResponse.json({ data: null, error: { message: result.error } }, { status: result.status });
  after(async () => {
    try {
      await driveTrip(store, parsed.data.planId, modelPlayers);
    } catch (error) {
      console.error("trip drive failed", error);
    }
  });
  return NextResponse.json({ data: { plan: result.plan }, error: null });
}
