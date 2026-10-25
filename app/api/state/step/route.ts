import { NextResponse } from "next/server";
import { z } from "zod";
import { dispatch } from "@/lib/ui/source";

export const dynamic = "force-dynamic";

/*
 * Fixture-only stepper that plays the recorded run before the real agents are
 * wired: it loads the reel, delivers the next message, and sets the labels.
 * Removed together with lib/ui/script.ts.
 */
const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("load_reel") }),
  z.object({ type: z.literal("next_message") }),
  z.object({ type: z.literal("set_simulated"), value: z.boolean() }),
  z.object({ type: z.literal("set_mode"), mode: z.enum(["live", "replay"]) }),
]);

export async function POST(request: Request) {
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: { message: "Unknown step action" } }, { status: 400 });
  }
  return NextResponse.json({ data: dispatch(parsed.data), error: null });
}
