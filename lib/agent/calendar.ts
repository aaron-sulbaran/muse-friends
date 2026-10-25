import type { Store } from "@/lib/store";
import type { AgentId, CalendarEvent, Window } from "@/lib/protocol";
import { CALENDAR_RANGE, getPersona } from "@/lib/seed/fixtures";
import { freeBlocks, toCentralIso, toMs } from "./windows";

// A room that sets a person's whole calendar (a judge typing their own free windows through the
// connector) says so with one marker block; the persona's seeded events then stay out of it.
export const CALENDAR_SET_BY_ROOM = "room_calendar";

// An agent's calendar as its own tools see it: the persona's seeded events plus busy blocks a
// judge added from the controls. Only the owner's agent ever reads this.
export async function ownCalendar(store: Store, agent: AgentId): Promise<CalendarEvent[]> {
  const added = await store.listBusy(agent);
  const events = added.filter((block) => block.event.id !== CALENDAR_SET_BY_ROOM).map((block) => block.event);
  const setByRoom = added.some((block) => block.event.id === CALENDAR_SET_BY_ROOM);
  return setByRoom ? events : [...getPersona(agent).calendar, ...events];
}

// Free blocks from the demo clock's "now" to the end of the seeded horizon, or the requested slice of it.
export async function ownFreeBlocks(store: Store, agent: AgentId, range?: Window): Promise<Window[]> {
  const [{ now }, calendar] = await Promise.all([store.getClock(), ownCalendar(store, agent)]);
  const start = Math.max(toMs(now), toMs(CALENDAR_RANGE.start), range ? toMs(range.start) : 0);
  const end = Math.min(toMs(CALENDAR_RANGE.end), range ? toMs(range.end) : Infinity);
  if (end <= start) return [];
  return freeBlocks(calendar, { start: toCentralIso(start), end: toCentralIso(end) });
}
