import { NextResponse } from "next/server";
import { namesFor } from "@/lib/ui/format";
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
  const stampedAt = plan.history.find((entry) => entry.state === "scheduled")?.at ?? snapshot.now;
  const body = buildHoldIcs({
    uid: `${plan.id}@muse-friends`,
    summary: `${plan.activityTitle} with ${namesFor(snapshot).human[role === "a" ? "lisa" : "aaron"]}`,
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
