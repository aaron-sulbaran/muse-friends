import { NextResponse } from "next/server";
import { z } from "zod";
import { declineProposal } from "@/lib/agent/proposals";
import { httpDeliver } from "@/lib/agent/wire";
import { ROLE_TO_AGENT } from "@/lib/seed/fixtures";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.strictObject({ role: z.enum(["a", "b"]) });

/**
 * The person declines a payment their Muse prepared (D28): nothing moves, and the friend's Muse is told. Only the
 * person it is for may decline; a second decline answers the same decision; a payment already confirmed cannot be
 * declined here (the friend's Muse decides that one).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/payments/[id]/decline">) {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ data: null, error: { message: "Expected { role: a or b }" } }, { status: 400 });
  const agent = ROLE_TO_AGENT[parsed.data.role];
  const origin = new URL(request.url).origin;
  const result = await declineProposal({ store: await getStore(), deliver: httpDeliver(origin, agent) }, id, agent);
  if (!result.ok) return NextResponse.json({ data: null, error: { message: result.error } }, { status: result.status });
  return NextResponse.json({ data: { payment: { id: result.proposal.paymentId, status: result.proposal.status, amount: result.proposal.amount }, already: result.already }, error: null });
}
