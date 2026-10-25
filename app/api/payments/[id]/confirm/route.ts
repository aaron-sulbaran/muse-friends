import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmProposal } from "@/lib/agent/proposals";
import { httpDeliver } from "@/lib/agent/wire";
import { ROLE_TO_AGENT } from "@/lib/seed/fixtures";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.strictObject({ role: z.enum(["a", "b"]) });

/**
 * The person confirms a payment their Muse prepared (D28): the one deliberate step. Money moves only here: the same
 * policy and cap checks as ever, the withdrawal, the payment message to the friend's Muse (which then accepts it or
 * sends it back), the ledger. Only the person it is for may confirm; a second confirm answers the same payment and
 * moves nothing more. The payment belongs to the room's store, so an id from anywhere else is a 404.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/payments/[id]/confirm">) {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ data: null, error: { message: "Expected { role: a or b }" } }, { status: 400 });
  const agent = ROLE_TO_AGENT[parsed.data.role];
  const origin = new URL(request.url).origin;
  const result = await confirmProposal({ store: await getStore(), deliver: httpDeliver(origin, agent) }, id, agent);
  if (!result.ok) return NextResponse.json({ data: null, error: { message: result.error } }, { status: result.status });
  return NextResponse.json({ data: { payment: { id: result.proposal.paymentId, status: result.proposal.status, amount: result.proposal.amount }, already: result.already }, error: null });
}
