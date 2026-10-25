import { NextResponse } from "next/server";
import { z } from "zod";
import { dispatch, readSnapshot } from "@/lib/ui/source";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  role: z.enum(["a", "b"]),
  choice: z.enum(["accept", "decline"]),
});

export async function POST(request: Request, ctx: RouteContext<"/api/plans/[id]/decision">) {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: { message: "Expected { role: a or b, choice: accept or decline }" } }, { status: 400 });
  }
  const current = readSnapshot().plan;
  if (!current || current.id !== id) {
    return NextResponse.json({ data: null, error: { message: "No such plan" } }, { status: 404 });
  }
  if (current.state !== "awaiting_humans") {
    return NextResponse.json({ data: null, error: { message: `Plan is ${current.state}, not waiting for a decision` } }, { status: 409 });
  }
  const snapshot = dispatch({ type: "decide", ...parsed.data });
  return NextResponse.json({ data: snapshot.plan, error: null });
}
