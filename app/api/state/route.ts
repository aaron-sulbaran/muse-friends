import { NextResponse } from "next/server";
import { readJudgeRoom } from "@/app/api/connector/_lib/keyless";
import { readCursor, readSnapshot } from "@/lib/ui/source";

export const dynamic = "force-dynamic";

/**
 * The snapshot the phones and the stage poll every second. The store's cursor is
 * the ETag, so a poll with nothing new costs a 304 and never reads the snapshot.
 * `role` is accepted for the contract and the snapshot is the same for both roles. `room` is the demo room unless
 * it is the code of a live judge room (the keyless path, app/j), which the table screen can show by opening
 * `/?room=<code>`; a judge room answers from its own storage and never from the demo store.
 */
export async function GET(request: Request) {
  const room = new URL(request.url).searchParams.get("room");
  const judge = room ? await readJudgeRoom(room) : null;
  if (judge) {
    const judgeEtag = `"${judge.etag}"`;
    const judgeHeaders = { "Cache-Control": "no-store", ETag: judgeEtag };
    if (request.headers.get("if-none-match") === judgeEtag) return new Response(null, { status: 304, headers: judgeHeaders });
    return NextResponse.json(judge.ui, { headers: judgeHeaders });
  }
  const etag = `"${await readCursor()}"`;
  const headers = { "Cache-Control": "no-store", ETag: etag };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return NextResponse.json(await readSnapshot(), { headers });
}
