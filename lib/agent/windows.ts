import type { CalendarEvent, Window } from "@/lib/protocol";

// Pure time-window helpers: free blocks from a calendar, set intersection, subset checks, and
// a stable hash for the rejected-window ledger. The demo week sits before the Nov 1 DST change,
// so US Central is a fixed UTC-05:00 here.
const CENTRAL_OFFSET_MINUTES = -300;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function toMs(iso: string): number {
  return Date.parse(iso);
}

export function toCentralIso(ms: number): string {
  const shifted = new Date(ms + CENTRAL_OFFSET_MINUTES * MINUTE_MS);
  return shifted.toISOString().replace(/\.\d{3}Z$/, "-05:00");
}

function makeWindow(startMs: number, endMs: number): Window {
  return { start: toCentralIso(startMs), end: toCentralIso(endMs) };
}

// Free blocks only ever sit inside waking hours: 9am to 10pm, split at midnight.
export const WAKING_HOURS = { start: 9, end: 22 } as const;

export function localMidnight(ms: number): number {
  const shifted = ms + CENTRAL_OFFSET_MINUTES * MINUTE_MS;
  return Math.floor(shifted / DAY_MS) * DAY_MS - CENTRAL_OFFSET_MINUTES * MINUTE_MS;
}

export type FreeBlockOptions = {
  dayStartHour?: number;
  dayEndHour?: number;
  minMinutes?: number;
};

// Free blocks inside waking hours, clipped to `range`, at least `minMinutes` long.
export function freeBlocks(calendar: CalendarEvent[], range: Window, options: FreeBlockOptions = {}): Window[] {
  const { dayStartHour = WAKING_HOURS.start, dayEndHour = WAKING_HOURS.end, minMinutes = 60 } = options;
  const rangeStart = toMs(range.start);
  const rangeEnd = toMs(range.end);
  const busy = calendar
    .map((event) => ({ start: toMs(event.start), end: toMs(event.end) }))
    .sort((a, b) => a.start - b.start);

  const blocks: Window[] = [];
  for (let dayStart = localMidnight(rangeStart); dayStart < rangeEnd; dayStart += DAY_MS) {
    let cursor = Math.max(dayStart + dayStartHour * HOUR_MS, rangeStart);
    const limit = Math.min(dayStart + dayEndHour * HOUR_MS, rangeEnd);
    for (const event of busy) {
      if (event.end <= cursor || event.start >= limit) continue;
      if (event.start > cursor) blocks.push(makeWindow(cursor, event.start));
      cursor = Math.max(cursor, event.end);
    }
    if (cursor < limit) blocks.push(makeWindow(cursor, limit));
  }
  return blocks.filter((block) => toMs(block.end) - toMs(block.start) >= minMinutes * MINUTE_MS);
}

// Pairwise overlap of two window lists, at least `minMinutes` long, sorted by start.
export function intersectWindows(a: Window[], b: Window[], minMinutes = 60): Window[] {
  const overlaps: Window[] = [];
  for (const left of a) {
    for (const right of b) {
      const start = Math.max(toMs(left.start), toMs(right.start));
      const end = Math.min(toMs(left.end), toMs(right.end));
      if (end - start >= minMinutes * MINUTE_MS) overlaps.push(makeWindow(start, end));
    }
  }
  return overlaps.sort((x, y) => toMs(x.start) - toMs(y.start));
}

export function isSubsetOfBlocks(window: Window, blocks: Window[]): boolean {
  const start = toMs(window.start);
  const end = toMs(window.end);
  return blocks.some((block) => toMs(block.start) <= start && end <= toMs(block.end));
}

export function windowsOverlap(a: Window, b: Window): boolean {
  return toMs(a.start) < toMs(b.end) && toMs(b.start) < toMs(a.end);
}

// FNV-1a over the window's epoch milliseconds: stable, dependency free, safe in any bundle.
export function windowHash(window: Window): string {
  const input = `${toMs(window.start)}-${toMs(window.end)}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `w_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function clockLabel(ms: number): { weekday: string; hour: number; minute: number } {
  const shifted = new Date(ms + CENTRAL_OFFSET_MINUTES * MINUTE_MS);
  return {
    weekday: WEEKDAYS[shifted.getUTCDay()],
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function formatHour(hour: number, minute: number, withSuffix: boolean): string {
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  const suffix = hour >= 12 ? "pm" : "am";
  const time = minute === 0 ? `${twelve}` : `${twelve}:${String(minute).padStart(2, "0")}`;
  return withSuffix ? `${time}${suffix}` : time;
}

// "Tue 6 to 8pm" for cards, notes, and prompts.
export function describeWindow(window: Window): string {
  const start = clockLabel(toMs(window.start));
  const end = clockLabel(toMs(window.end));
  const sameSuffix = start.hour >= 12 === end.hour >= 12;
  return `${start.weekday} ${formatHour(start.hour, start.minute, !sameSuffix)} to ${formatHour(end.hour, end.minute, true)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "Sun Oct 25, 2pm" for prompts.
export function describeInstant(ms: number): string {
  const shifted = new Date(ms + CENTRAL_OFFSET_MINUTES * MINUTE_MS);
  const label = clockLabel(ms);
  return `${label.weekday} ${MONTHS[shifted.getUTCMonth()]} ${shifted.getUTCDate()}, ${formatHour(label.hour, label.minute, true)}`;
}

// Parses a time a model wrote. Anything without an offset is read as US Central.
export function parseWhen(text: string): number {
  const trimmed = text.trim();
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const candidate = dateOnly ? `${trimmed}T00:00:00-05:00` : hasOffset ? trimmed : `${trimmed}-05:00`;
  return Date.parse(candidate);
}
