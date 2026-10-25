import { NextResponse } from "next/server";
import { recordedTripRun, tripRunBundle } from "@/lib/seed/trip-run";
import { getStore } from "@/lib/store";
import { buildReplay } from "@/lib/ui/replay";
import { loadReplay } from "@/lib/ui/replay-source";

export const dynamic = "force-dynamic";

/**
 * Every frame of the best recorded run, ready to play. The stage fetches it once
 * ahead of time, so a replay does not depend on the network once it has loaded.
 * `?scenario=trip` plays the recorded trip for three instead (lib/seed/trip-run.json), labeled with the model that made it.
 */
export async function GET(request?: Request) {
  if (request && new URL(request.url).searchParams.get("scenario") === "trip") {
    const run = recordedTripRun();
    if (!run) return NextResponse.json({ data: null, error: { message: "There is no recorded trip yet" } }, { status: 404 });
    return NextResponse.json({ data: buildReplay(run, { model: tripRunBundle()?.model }), error: null });
  }
  return NextResponse.json({ data: await loadReplay(await getStore()), error: null });
}
