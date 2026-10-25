import { withRoom, withoutRoom } from "@/app/api/_lib/room";
import { NextResponse } from "next/server";
import { z } from "zod";
import { addBusyBlock } from "@/lib/agent/controls";
import { ROLE_TO_AGENT } from "@/lib/seed/fixtures";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ role: z.enum(["a", "b"]) });

function refuse(message: string, status: number) {
  return NextResponse.json({ data: null, error: { message } }, { status });
}

/**
 * "That time doesn't work for me": marks the plan's window busy on this person's calendar, so the agents
 * plan around it from now on. Nothing re-plans by itself, so the page then starts a new run; this route
 * only changes the calendar, and only while the plan is waiting on people.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/plans/[id]/busy">) {
  const { id } = await ctx.params;
  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(withoutRoom(raw));
  if (!parsed.success) return refuse("Expected { role: a or b }", 400);
  return withRoom(request, raw, {}, async (room) => {
    const store = room.store;
    const plan = await store.getPlan(id);
    if (!plan) return refuse("No such plan", 404);
    if (plan.state !== "awaiting_humans" || !plan.window) return refuse("A time can be changed while the plan is waiting on people", 409);

    const result = await addBusyBlock(store, { agent: ROLE_TO_AGENT[parsed.data.role], start: plan.window.start, end: plan.window.end });
    if (!result.ok) return refuse(result.error, result.status);
    return NextResponse.json({ data: { busy: result.value.event }, error: null });
  });
}
