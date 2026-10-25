import { NextResponse } from "next/server";
import { withRoom, withoutRoom } from "@/app/api/_lib/room";
import { AvailabilityBody, checkFeels, checkName, checkWindows, saveAvailability } from "@/lib/agent/availability";
import { toCentralIso, toMs } from "@/lib/agent/windows";
import { ROLE_TO_AGENT } from "@/lib/seed/fixtures";

export const dynamic = "force-dynamic";

const SHAPE = 'Send { side: "a" or "b", windows: a list of { start, end }, feels?: one line of text, name?: a first name }.';

function refuse(message: string, status: number) {
  return NextResponse.json({ ok: false, data: null, error: { message } }, { status });
}

/**
 * A person types the times they are free, and optionally one line on how they feel. `side` is the seat, `windows` are
 * ISO times on the room's clock, each at least an hour, inside one day between 9am and 10pm, from the room's now to the
 * end of the week the Muses can see, at most 8. The seat's calendar then is exactly these times (nothing seeded is
 * left in it), and the line is read by that Muse through get_interests, shared only if its person shares interests.
 * A second call for the same side replaces the first. Answers { ok: true, windows } with the count that was kept
 * (touching and overlapping times are merged), or 400 with a plain message. The call can make a phone room, like a reel
 * or a control, because it is usually the first thing a phone does.
 */
export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = AvailabilityBody.safeParse(withoutRoom(raw));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const named = issue && issue.code !== "unrecognized_keys" && ["side", "windows", "feels", "name"].includes(String(issue.path[0]));
    return refuse(named ? issue.message : SHAPE, 400);
  }
  const feels = checkFeels(parsed.data.feels);
  if (!feels.ok) return refuse(feels.message, 400);
  const name = checkName(parsed.data.name);
  if (!name.ok) return refuse(name.message, 400);

  return withRoom(request, raw, { mint: true }, async (room) => {
    const { now } = await room.store.getClock();
    const windows = checkWindows(parsed.data.windows, toMs(now));
    if (!windows.ok) return refuse(windows.message, 400);
    const saved = await saveAvailability(room.store, ROLE_TO_AGENT[parsed.data.side], { windows: windows.value, feels: feels.value, name: name.value }, toCentralIso(Date.now()));
    return NextResponse.json({ ok: true, windows: saved.windows.length, error: null });
  });
}
