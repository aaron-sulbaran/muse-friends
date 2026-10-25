import { NextResponse } from "next/server";
import { listOf, namesFor } from "@/lib/ui/format";
import { buildHoldIcs } from "@/lib/ui/ics";
import { readSnapshot } from "@/lib/ui/source";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: RouteContext<"/api/plans/[id]/hold.ics">) {
  const { id } = await ctx.params;
  const role = new URL(request.url).searchParams.get("role") === "b" ? "b" : "a";
  const snapshot = await readSnapshot();
  const plan = snapshot.plan;
  if (!plan || plan.id !== id) {
    return NextResponse.json({ data: null, error: { message: "No such plan" } }, { status: 404 });
  }
  if (!plan.window || plan.state === "dropped") {
    return NextResponse.json({ data: null, error: { message: "This plan has no time to hold" } }, { status: 409 });
  }
  // A plan for three holds the time with both of the others.
  const names = namesFor(snapshot).human;
  const me = role === "a" ? "aaron" : "lisa";
  const withWhom = plan.group ? listOf(plan.group.members.filter((member) => member.id !== me).map((member) => names[member.id])) : names[role === "a" ? "lisa" : "aaron"];
  const stampedAt = plan.history.find((entry) => entry.state === "scheduled")?.at ?? snapshot.now;
  const body = buildHoldIcs({
    uid: `${plan.id}@muse-friends`,
    summary: `${plan.activityTitle} with ${withWhom}`,
    window: plan.window,
    stampedAt,
  });
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="hold.ics"',
      "Cache-Control": "no-store",
    },
  });
}
