import { NextResponse } from "next/server";
import { tryToLeak } from "@/lib/ui/leak";

export const dynamic = "force-dynamic";

// A button on the presenter's stage, so it is cheap to hold open to a crowd: a few a minute per instance is plenty.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 8;
const recent: number[] = [];

/** Sends two forged messages to Mochi's inbox and returns what it answered. Nothing is delivered if the checks hold. */
export async function POST(request: Request) {
  const now = Date.now();
  while (recent.length > 0 && now - recent[0] > WINDOW_MS) recent.shift();
  if (recent.length >= MAX_PER_WINDOW) {
    return NextResponse.json({ data: null, error: { message: "Too many leak attempts a minute; wait a moment" } }, { status: 429 });
  }
  recent.push(now);

  const attempts = await tryToLeak(new URL(request.url).origin);
  return NextResponse.json({ data: { attempts }, error: null });
}
