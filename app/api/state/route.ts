import { NextResponse } from "next/server";
import { readPhoneRoom } from "@/app/api/_lib/room";
import { readJudgeRoom } from "@/app/api/connector/_lib/keyless";
import { forRole } from "@/lib/ui/snapshot";
import { readCursor, readSnapshot } from "@/lib/ui/source";

export const dynamic = "force-dynamic";

/**
 * The snapshot the phones and the stage poll every second. The store's cursor is
 * the ETag, so a poll with nothing new costs a 304 and never reads the snapshot.
 * `role` is `a` or `b`: the full snapshot for no role (the stage, the gate); for `a` (side a's phone) the same without side
 * b's typed availability; and for `b` (or anything else) the snapshot without side a's chat lines and "You asked" rows,
 * and with only side b's typed availability (see `forRole`). `room` is the demo room unless
 * it is the code of a live judge room (the keyless path, app/j), which the table screen can show by opening
 * `/?room=<code>`; a judge room answers from its own storage and never from the demo store. Any other valid room id
 * is a phone's room (app/api/_lib/room.ts): its own state, or the empty stage until its first write makes it.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const room = params.get("room");
  const role = params.get("role");
  // Each view has a different body for the same cursor, so each gets its own ETag: the stage, side a, and everything else.
  const view = role === null ? "" : role === "a" ? "-a" : "-b";
  const judge = room ? await readJudgeRoom(room) : null;
  if (judge) {
    const judgeEtag = `"${judge.etag}${view}"`;
    const judgeHeaders = { "Cache-Control": "no-store", ETag: judgeEtag };
    if (request.headers.get("if-none-match") === judgeEtag) return new Response(null, { status: 304, headers: judgeHeaders });
    return NextResponse.json(forRole(judge.ui, role), { headers: judgeHeaders });
  }
  const phone = room ? await readPhoneRoom(request) : null;
  if (phone) {
    const phoneEtag = `"${phone.etag}${view}"`;
    const phoneHeaders = { "Cache-Control": "no-store", ETag: phoneEtag };
    if (request.headers.get("if-none-match") === phoneEtag) return new Response(null, { status: 304, headers: phoneHeaders });
    return NextResponse.json(forRole(phone.ui, role), { headers: phoneHeaders });
  }
  const etag = `"${await readCursor()}${view}"`;
  const headers = { "Cache-Control": "no-store", ETag: etag };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
  return NextResponse.json(forRole(await readSnapshot(), role), { headers });
}
