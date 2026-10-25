import { converse, withRoom, withoutRoom } from "@/app/api/_lib/room";
import { NextResponse } from "next/server";
import { z } from "zod";
import { declineProposal } from "@/lib/agent/proposals";
import { ROLE_TO_AGENT } from "@/lib/seed/fixtures";

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
  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(withoutRoom(raw));
  if (!parsed.success) return NextResponse.json({ data: null, error: { message: "Expected { role: a or b }" } }, { status: 400 });
  const agent = ROLE_TO_AGENT[parsed.data.role];
  const origin = new URL(request.url).origin;
  return withRoom(request, raw, {}, async (room) => {
    const contextId = (await room.store.listPlans()).at(-1)?.contextId ?? "";
    let outcome: Awaited<ReturnType<typeof declineProposal>> | null = null;
    // In a room the friend's Muse answers in this process, right after the message is sent.
    await converse(room, contextId, async () => {
      outcome = await declineProposal({ store: room.store, deliver: room.deliver(origin, agent) }, id, agent);
    });
    const result = outcome as Awaited<ReturnType<typeof declineProposal>> | null;
    if (!result) return NextResponse.json({ data: null, error: { message: "Could not complete that" } }, { status: 500 });
    if (!result.ok) return NextResponse.json({ data: null, error: { message: result.error } }, { status: result.status });
    return NextResponse.json({ data: { payment: { id: result.proposal.paymentId, status: result.proposal.status, amount: result.proposal.amount }, already: result.already }, error: null }, { status: 200 });
  });
}
