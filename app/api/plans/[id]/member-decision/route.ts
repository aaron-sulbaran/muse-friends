import { NextResponse } from "next/server";
import { z } from "zod";
import { decide } from "@/lib/agent/lifecycle";
import { MEMBER_IDS } from "@/lib/protocol";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  member: z.enum(MEMBER_IDS),
  choice: z.enum(["accept", "decline"]),
});

/**
 * A person taps their card, named by member id rather than by phone seat. The two-person flow keeps using
 * ../decision with role a or b; this is the way for the third person in a group plan (kai, Pebble's human)
 * to answer, since the room has only two phones. Same lifecycle, same refusals.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/plans/[id]/member-decision">) {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: { message: "Expected { member: aaron, lisa or kai, choice: accept or decline }" } }, { status: 400 });
  }
  const result = await decide(await getStore(), { planId: id, agent: parsed.data.member, choice: parsed.data.choice });
  if (!result.ok) return NextResponse.json({ data: null, error: { message: result.error } }, { status: result.status });
  return NextResponse.json({ data: { plan: result.value.plan }, error: null });
}
