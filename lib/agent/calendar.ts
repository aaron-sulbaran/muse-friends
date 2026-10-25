import type { Store } from "@/lib/store";
import type { CalendarEvent, MemberId, Window } from "@/lib/protocol";
import { CALENDAR_RANGE, getPersona } from "@/lib/seed/fixtures";
import { availabilityOf, busyAround } from "./availability";
import { freeBlocks, toCentralIso, toMs } from "./windows";

// A room that sets a person's whole calendar (a judge's room, from a fixed preset through the connector)
// says so with one marker block per person (id room_calendar plus a suffix); the persona's seeded events then stay out of it.
export const CALENDAR_SET_BY_ROOM = "room_calendar";

// An agent's calendar as its own tools see it: the persona's seeded events plus busy blocks a
// judge added from the controls. Only the owner's agent ever reads this.
// A person who typed the times they are free (POST /api/availability) sets the whole calendar the same way a marker
// does: the seeded events stay out and everything outside their windows is busy. Blocks added from the controls
// still count on top of either.
export async function ownCalendar(store: Store, agent: MemberId): Promise<CalendarEvent[]> {
  const [added, room] = await Promise.all([store.listBusy(agent), store.getRoom()]);
  const isMarker = (block: { event: CalendarEvent }) => block.event.id.startsWith(CALENDAR_SET_BY_ROOM);
  const events = added.filter((block) => !isMarker(block)).map((block) => block.event);
  const typed = availabilityOf(room, agent);
  if (typed && agent !== "kai") return [...busyAround(agent, typed.windows), ...events];
  const setByRoom = added.some(isMarker);
  return setByRoom ? events : [...getPersona(agent).calendar, ...events];
}

// Free blocks from the demo clock's "now" to the end of the seeded horizon, or the requested slice of it.
export async function ownFreeBlocks(store: Store, agent: MemberId, range?: Window): Promise<Window[]> {
  const [{ now }, calendar] = await Promise.all([store.getClock(), ownCalendar(store, agent)]);
  const start = Math.max(toMs(now), toMs(CALENDAR_RANGE.start), range ? toMs(range.start) : 0);
  const end = Math.min(toMs(CALENDAR_RANGE.end), range ? toMs(range.end) : Infinity);
  if (end <= start) return [];
  return freeBlocks(calendar, { start: toCentralIso(start), end: toCentralIso(end) });
}
