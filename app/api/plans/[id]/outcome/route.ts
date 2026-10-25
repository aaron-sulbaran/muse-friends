import { NextResponse } from "next/server";
import { z } from "zod";
import { withRoom, withoutRoom } from "@/app/api/_lib/room";
import { recordOutcome } from "@/lib/ui/outcome";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ role: z.enum(["a", "b"]), result: z.enum(["went", "didnt"]) });

/** A person says whether the plan happened. "went" is the only thing the Follow-through counter counts. */
export async function POST(request: Request, ctx: RouteContext<"/api/plans/[id]/outcome">) {
  const { id } = await ctx.params;
  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(withoutRoom(raw));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: { message: "Expected { role: a or b, result: went or didnt }" } }, { status: 400 });
  }
  return withRoom(request, raw, {}, async (room) => {
    const result = await recordOutcome(room.store, { planId: id, ...parsed.data });
    if (!result.ok) return NextResponse.json({ data: null, error: { message: result.error } }, { status: result.status });
    return NextResponse.json({ data: { outcome: result.value.outcome }, error: null });
  });
}
