import { NextResponse } from "next/server";
import { z } from "zod";
import { whatsAppUrl } from "@/lib/ui/handoff";
import { dispatch, readSnapshot } from "@/lib/ui/source";

export const dynamic = "force-dynamic";

/** The drafted message and the WhatsApp link that carries it. The person picks the contact and presses send. */
export async function GET(_request: Request, ctx: RouteContext<"/api/plans/[id]/draft">) {
  const { id } = await ctx.params;
  const plan = readSnapshot().plan;
  if (!plan || plan.id !== id) {
    return NextResponse.json({ data: null, error: { message: "No such plan" } }, { status: 404 });
  }
  if (!plan.draft) {
    return NextResponse.json({ data: null, error: { message: "No draft yet; both people have to say yes first" } }, { status: 409 });
  }
  return NextResponse.json({ data: { draft: plan.draft, whatsAppUrl: whatsAppUrl(plan.draft) }, error: null });
}

const handoffSchema = z.object({ via: z.enum(["whatsapp", "copy"]) });

/** Records that the person took the draft away, which is the human event that lets the plan move on. */
export async function POST(request: Request, ctx: RouteContext<"/api/plans/[id]/draft">) {
  const { id } = await ctx.params;
  const parsed = handoffSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: { message: "Expected { via: whatsapp or copy }" } }, { status: 400 });
  }
  const plan = readSnapshot().plan;
  if (!plan || plan.id !== id) {
    return NextResponse.json({ data: null, error: { message: "No such plan" } }, { status: 404 });
  }
  const snapshot = dispatch({ type: "handoff" });
  return NextResponse.json({ data: snapshot.plan, error: null });
}
