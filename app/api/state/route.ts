import { NextResponse } from "next/server";
import { readCursor, readSnapshot } from "@/lib/ui/source";

export const dynamic = "force-dynamic";

/**
 * The snapshot the phones and the stage poll every second. The cursor doubles as
 * the ETag, so a poll with nothing new costs a 304 and no body. `room` and `role`
 * are accepted for the contract; the one room is "demo" and the snapshot is the
 * same for both roles.
 */
export function GET(request: Request) {
  const snapshot = readSnapshot();
  const etag = `"${readCursor(snapshot)}"`;
  const headers = { "Cache-Control": "no-store", ETag: etag };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return NextResponse.json(snapshot, { headers });
}
