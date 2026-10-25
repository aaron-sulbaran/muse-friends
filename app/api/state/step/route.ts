import { NextResponse } from "next/server";
import { z } from "zod";
import { dispatch } from "@/lib/ui/source";

export const dynamic = "force-dynamic";

/*
 * Fixture-only stepper that drives the recorded run before the real agents are
 * wired. Removed together with lib/ui/fixture.ts.
 */
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("load_reel") }),
  z.object({ type: z.literal("next_message") }),
  z.object({ type: z.literal("clock_next") }),
  z.object({ type: z.literal("set_location"), shared: z.boolean() }),
  z.object({ type: z.literal("set_simulated"), value: z.boolean() }),
  z.object({ type: z.literal("set_mode"), mode: z.enum(["live", "replay"]) }),
  z.object({ type: z.literal("reset") }),
]);

export async function POST(request: Request) {
  const body: unknown = await request.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: { message: "Unknown step action" } }, { status: 400 });
  }
  return NextResponse.json({ data: dispatch(parsed.data), error: null });
}
