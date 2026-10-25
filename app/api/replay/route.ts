import { NextResponse } from "next/server";
import { getStore } from "@/lib/store";
import { loadReplay } from "@/lib/ui/replay-source";

export const dynamic = "force-dynamic";

/**
 * Every frame of the best recorded run, ready to play. The stage fetches it once
 * ahead of time, so a replay does not depend on the network once it has loaded.
 */
export async function GET() {
  return NextResponse.json({ data: await loadReplay(await getStore()), error: null });
}
