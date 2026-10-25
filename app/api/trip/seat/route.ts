import { after, NextResponse } from "next/server";
import { z } from "zod";
import { driveTrip } from "@/lib/agent/trip";
import { bookSeat } from "@/lib/agent/trip-booking";
import { MemberId } from "@/lib/protocol";
import { getStore } from "@/lib/store";
import { modelPlayers } from "@/lib/ui/group-players";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.strictObject({ planId: z.string().min(1), member: MemberId, flight: z.string().min(1).max(10) });

/**
 * A person books their own seat on one of the seeded flights. The price comes from their share of the pot, then their own
 * trip wallet, only on this tap, and a second tap for the same person books nothing more (409). A simulated booking:
 * seeded prices, paper dollars on the demo's local ledger.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ data: null, error: { message: "Expected { planId, member, flight }" } }, { status: 400 });
  const store = await getStore();
  const result = await bookSeat(store, { planId: parsed.data.planId, member: parsed.data.member, flightId: parsed.data.flight, by: "person" });
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
