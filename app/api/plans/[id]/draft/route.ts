import { NextResponse } from "next/server";
import { z } from "zod";
import { recordHandoff } from "@/lib/agent/lifecycle";
import { ROLE_TO_AGENT } from "@/lib/seed/fixtures";
import { getStore } from "@/lib/store";
import { whatsAppUrl } from "@/lib/ui/handoff";

export const dynamic = "force-dynamic";

/** The drafted message and the WhatsApp link that carries it. The person picks the contact and presses send. */
export async function GET(_request: Request, ctx: RouteContext<"/api/plans/[id]/draft">) {
  const { id } = await ctx.params;
  const plan = await (await getStore()).getPlan(id);
  if (!plan) return NextResponse.json({ data: null, error: { message: "No such plan" } }, { status: 404 });
  if (!plan.draft) {
    return NextResponse.json({ data: null, error: { message: "No draft yet; both people have to say yes first" } }, { status: 409 });
  }
  return NextResponse.json({ data: { draft: plan.draft, whatsAppUrl: whatsAppUrl(plan.draft) }, error: null });
}

const handoffSchema = z.object({ role: z.enum(["a", "b"]), via: z.enum(["whatsapp", "copy"]) });

/** Records that the person took the draft away: the handoff event, and on a confirmed plan the calendar hold. */
export async function POST(request: Request, ctx: RouteContext<"/api/plans/[id]/draft">) {
  const { id } = await ctx.params;
  const parsed = handoffSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: { message: "Expected { role: a or b, via: whatsapp or copy }" } }, { status: 400 });
  }
  const result = await recordHandoff(await getStore(), { planId: id, agent: ROLE_TO_AGENT[parsed.data.role], via: parsed.data.via });
  if (!result.ok) return NextResponse.json({ data: null, error: { message: result.error } }, { status: result.status });
  return NextResponse.json({ data: { plan: result.value.plan }, error: null });
}
