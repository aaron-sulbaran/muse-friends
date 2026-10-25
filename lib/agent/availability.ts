import { z } from "zod";
import {
  AVAILABILITY_MAX_WINDOWS,
  AVAILABILITY_MIN_MINUTES,
  FEELS_MAX,
  IsoDateTime,
  type AgentId,
  type CalendarEvent,
  type MemberId,
  type Persona,
  type Room,
  type TypedAvailability,
  type Window,
} from "@/lib/protocol";
import { CALENDAR_RANGE } from "@/lib/seed/fixtures";
import type { Store } from "@/lib/store";
import { describeInstant, localMidnight, toCentralIso, toMs, WAKING_HOURS } from "./windows";

// What a person typed about their own week (POST /api/availability). The windows are the times they are free: the room
// sets that seat's whole calendar from them, so the seeded events stay out and every free-time reader (the Muse's own
// tools, the window checks on send and receive, the scripted fallback) sees exactly these times and nothing else. The
// feels line is one sentence in their own words; it is interests, so it reaches the friend's Muse only through the
// interests category of the sharing settings. A seat with nothing typed keeps its seeded calendar, untouched.

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

export const AvailabilityBody = z.strictObject({
  side: z.enum(["a", "b"], { error: 'side must be "a" or "b"' }),
  windows: z.array(z.unknown(), { error: "windows must be a list of { start, end }" }),
  feels: z.string({ error: "feels must be one line of text" }).optional(),
});

const RawWindow = z.strictObject({ start: IsoDateTime, end: IsoDateTime });

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string };
const no = (message: string): { ok: false; message: string } => ({ ok: false, message });

/** The days the typed times may fall in: from the room's now to the end of the calendar the Muses can see. */
export function horizonAt(nowMs: number): { start: number; end: number } {
  return { start: Math.max(nowMs, toMs(CALENDAR_RANGE.start)), end: toMs(CALENDAR_RANGE.end) };
}

/**
 * Plain checks, each with a message a person can act on. Every time must be at least an hour, inside the horizon, and
 * inside one waking day (9am to 10pm), because that is all a free block can ever be: this keeps "exactly the typed
 * windows" true. Overlapping and touching times are merged, so the count that comes back is the count that is stored.
 */
export function checkWindows(raw: unknown[], nowMs: number): Checked<Window[]> {
  if (raw.length === 0) return no("Add at least one time you are free.");
  if (raw.length > AVAILABILITY_MAX_WINDOWS) return no(`Add at most ${AVAILABILITY_MAX_WINDOWS} times.`);
  const horizon = horizonAt(nowMs);
  if (horizon.end <= horizon.start) return no("There are no days left this week to plan in.");
  const lastEnd = localMidnight(horizon.end - 1) + WAKING_HOURS.end * HOUR_MS;

  const spans: Array<{ start: number; end: number }> = [];
  for (const [index, item] of raw.entries()) {
    const label = raw.length > 1 ? `Time ${index + 1}` : "That time";
    const parsed = RawWindow.safeParse(item);
    if (!parsed.success) return no(`${label} needs a start and an end as ISO times with an offset, like 2026-10-27T18:00:00-05:00.`);
    const start = toMs(parsed.data.start);
    const end = toMs(parsed.data.end);
    if (end <= start) return no(`${label} has to end after it starts.`);
    if (end - start < AVAILABILITY_MIN_MINUTES * MINUTE_MS) return no(`${label} is shorter than an hour. Free times are at least an hour long.`);
    if (start < horizon.start || end > horizon.end) return no(`${label} is outside the days your Muse can see. Pick times from ${describeInstant(horizon.start)} to ${describeInstant(lastEnd)}.`);
    const dayStart = localMidnight(start);
    if (start < dayStart + WAKING_HOURS.start * HOUR_MS || end > dayStart + WAKING_HOURS.end * HOUR_MS) return no(`${label} has to sit inside one day between 9am and 10pm.`);
    spans.push({ start, end });
  }

  spans.sort((first, second) => first.start - second.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return { ok: true, value: merged.map((span) => ({ start: toCentralIso(span.start), end: toCentralIso(span.end) })) };
}

/** One line: control characters and line breaks become spaces. An empty line is no line; a long one is refused. */
export function checkFeels(raw: string | undefined): Checked<string | undefined> {
  const line = raw?.replace(/\p{Cc}+/gu, " ").replace(/\s+/g, " ").trim();
  if (!line) return { ok: true, value: undefined };
  if (line.length > FEELS_MAX) return no(`Keep it to one line of ${FEELS_MAX} characters or fewer.`);
  return { ok: true, value: line };
}

/** Busy blocks over the rest of the calendar the Muses can see: everything outside the typed windows. */
export function busyAround(agent: AgentId, windows: Window[]): CalendarEvent[] {
  const gaps: Window[] = [];
  let cursor = toMs(CALENDAR_RANGE.start);
  for (const window of [...windows].sort((first, second) => toMs(first.start) - toMs(second.start))) {
    if (toMs(window.start) > cursor) gaps.push({ start: toCentralIso(cursor), end: window.start });
    cursor = Math.max(cursor, toMs(window.end));
  }
  if (cursor < toMs(CALENDAR_RANGE.end)) gaps.push({ start: toCentralIso(cursor), end: CALENDAR_RANGE.end });
  return gaps.map((gap, index) => ({ id: `typed_busy_${agent}_${index}`, title: "Busy", start: gap.start, end: gap.end, private: true }));
}

/** What a seat typed, or nothing. The third friend in a group has no phone and never types. */
export function availabilityOf(room: Pick<Room, "availability">, member: MemberId): TypedAvailability | undefined {
  return member === "kai" ? undefined : room.availability?.[member];
}

/** Replaces whatever this seat typed before. */
export async function saveAvailability(store: Store, agent: AgentId, input: { windows: Window[]; feels?: string }, at: string): Promise<TypedAvailability> {
  const typed: TypedAvailability = { windows: input.windows, ...(input.feels ? { feels: input.feels } : {}), at };
  const room = await store.getRoom();
  await store.putRoom({ ...room, availability: { ...room.availability, [agent]: typed } });
  return typed;
}

/**
 * The sender as the share policy should see them: their typed line counts as one of their interests, so a note that
 * repeats it word for word is taken out when interests are off. Used for scanning only; what is shared as data comes
 * from the persona itself, and a line this long could never be one of those values.
 */
export async function scannedAs(store: Store, persona: Persona): Promise<Persona> {
  const feels = availabilityOf(await store.getRoom(), persona.id)?.feels;
  if (!feels) return persona;
  return { ...persona, interests: { ...persona.interests, interests: [...(persona.interests.interests ?? []), feels] } };
}
