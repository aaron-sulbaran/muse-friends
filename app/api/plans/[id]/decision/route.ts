import { NextResponse } from "next/server";
import { z } from "zod";
import { decide } from "@/lib/agent/lifecycle";
import { ROLE_TO_AGENT } from "@/lib/seed/fixtures";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  role: z.enum(["a", "b"]),
  choice: z.enum(["accept", "decline"]),
});

/** A person taps their card. The lifecycle decides what the answer does to the plan and answers with a status. */
export async function POST(request: Request, ctx: RouteContext<"/api/plans/[id]/decision">) {
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ data: null, error: { message: "Expected { role: a or b, choice: accept or decline }" } }, { status: 400 });
  }
  const result = await decide(await getStore(), { planId: id, agent: ROLE_TO_AGENT[parsed.data.role], choice: parsed.data.choice });
  if (!result.ok) return NextResponse.json({ data: null, error: { message: result.error } }, { status: result.status });
  return NextResponse.json({ data: { plan: result.value.plan }, error: null });
}
