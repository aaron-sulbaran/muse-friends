import type { Store } from "@/lib/store";
import type { AgentId, CalendarEvent, Window } from "@/lib/protocol";
import { CALENDAR_RANGE, getPersona } from "@/lib/seed/fixtures";
import { freeBlocks, toCentralIso, toMs } from "./windows";

// An agent's calendar as its own tools see it: the persona's seeded events plus busy blocks a
// judge added from the controls. Only the owner's agent ever reads this.
export async function ownCalendar(store: Store, agent: AgentId): Promise<CalendarEvent[]> {
  const added = await store.listBusy(agent);
  return [...getPersona(agent).calendar, ...added.map((block) => block.event)];
}

// Free blocks from the demo clock's "now" to the end of the seeded horizon, or the requested slice of it.
export async function ownFreeBlocks(store: Store, agent: AgentId, range?: Window): Promise<Window[]> {
  const { now } = await store.getClock();
  const start = Math.max(toMs(now), toMs(CALENDAR_RANGE.start), range ? toMs(range.start) : 0);
  const end = Math.min(toMs(CALENDAR_RANGE.end), range ? toMs(range.end) : Infinity);
  if (end <= start) return [];
  return freeBlocks(await ownCalendar(store, agent), { start: toCentralIso(start), end: toCentralIso(end) });
}
