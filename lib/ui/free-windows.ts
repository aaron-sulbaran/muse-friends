import { toCentralIso, toMs } from "@/lib/agent/windows";

/*
 * "When are you free this week?" as concrete windows on the room's clock. The chips and a free-text line become ISO
 * windows in US Central (the demo week sits before the Nov 1 DST change, so the offset is fixed, as in
 * lib/agent/windows.ts). The rules mirror what POST /api/availability accepts: each window at least an hour, inside the
 * next 7 days, at most 8 in all. Pure, so the mapping is tested without a clock or a screen.
 */

export type FreeWindow = { start: string; end: string };

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const CENTRAL_OFFSET_MS = -5 * HOUR_MS;

export const MAX_FREE_WINDOWS = 8;
export const MIN_FREE_MS = HOUR_MS;
export const FREE_HORIZON_MS = 7 * DAY_MS;
export const FEELS_MAX = 120;

export type FreeChipId = "tonight" | "tomorrow_evening" | "saturday_afternoon" | "sunday";

type ChipRule = { id: FreeChipId; label: string; from: number; to: number; day: (todayWeekday: number) => number };

/** Days from today to the next given weekday, counting today only when `includeToday`. */
const daysUntil = (todayWeekday: number, weekday: number, includeToday: boolean) => {
  const diff = (weekday - todayWeekday + 7) % 7;
  return diff === 0 && !includeToday ? 7 : diff;
};

const CHIPS: readonly ChipRule[] = [
  { id: "tonight", label: "Tonight", from: 19, to: 22, day: () => 0 },
  { id: "tomorrow_evening", label: "Tomorrow evening", from: 18, to: 21, day: () => 1 },
  { id: "saturday_afternoon", label: "Saturday afternoon", from: 13, to: 17, day: (today) => daysUntil(today, 6, true) },
  { id: "sunday", label: "Sunday", from: 12, to: 16, day: (today) => daysUntil(today, 0, false) },
];

/** The Central calendar day an instant falls on: its midnight (as an instant) and its weekday, 0 for Sunday. */
function centralDay(ms: number): { midnight: number; weekday: number } {
  const shifted = ms + CENTRAL_OFFSET_MS;
  const dayStart = Math.floor(shifted / DAY_MS) * DAY_MS;
  return { midnight: dayStart - CENTRAL_OFFSET_MS, weekday: new Date(dayStart).getUTCDay() };
}

const at = (midnight: number, hour: number, minute = 0) => midnight + hour * HOUR_MS + minute * 60_000;

function windowAt(startMs: number, endMs: number): FreeWindow {
  return { start: toCentralIso(startMs), end: toCentralIso(endMs) };
}

/** Whether a span can be sent: starts after now, ends within 7 days, and is at least an hour. */
function fitsTheWeek(startMs: number, endMs: number, nowMs: number): boolean {
  return startMs > nowMs && endMs <= nowMs + FREE_HORIZON_MS && endMs - startMs >= MIN_FREE_MS;
}

export type FreeChip = { id: FreeChipId; label: string; window: FreeWindow };

/** The chips on offer right now: only those whose window is still ahead and inside the week, with the windows they stand for. */
export function freeChips(nowIso: string): FreeChip[] {
  const nowMs = toMs(nowIso);
  const today = centralDay(nowMs);
  return CHIPS.flatMap((chip) => {
    const midnight = today.midnight + chip.day(today.weekday) * DAY_MS;
    const start = at(midnight, chip.from);
    const end = at(midnight, chip.to);
    return fitsTheWeek(start, end, nowMs) ? [{ id: chip.id, label: chip.label, window: windowAt(start, end) }] : [];
  });
}

const WEEKDAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const PIECE = /^(sun|mon|tue|wed|thu|fri|sat)[a-z]*\.?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:to|-|until|through)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i;

const meridiemOf = (value: string | undefined) => (value ? (value.toLowerCase().startsWith("a") ? "am" : "pm") : null);

function hourOn(hour: number, minute: number, meridiem: "am" | "pm" | null, fallback: "am" | "pm"): number | null {
  if (hour < 1 || hour > 12 || minute > 59) return null;
  const half = meridiem ?? fallback;
  const base = hour % 12;
  return (half === "pm" ? base + 12 : base) + minute / 60;
}

export type ParsedFreeText = { windows: FreeWindow[]; errors: string[] };

/**
 * A simple free-text line: "Tue 6 to 8 PM", "Thursday 5:30-7pm", several separated by commas or new lines. With no AM or PM,
 * the hours 8 to 11 read as morning and 12 and 1 to 7 as afternoon and evening. The day is the next one of that name,
 * today only when the window is still ahead. Anything it cannot read is named in `errors`, and the rest still counts.
 */
export function parseFreeText(text: string, nowIso: string): ParsedFreeText {
  const nowMs = toMs(nowIso);
  const today = centralDay(nowMs);
  const windows: FreeWindow[] = [];
  const errors: string[] = [];
  for (const piece of text.split(/[,;\n]/).map((part) => part.trim()).filter(Boolean)) {
    const match = PIECE.exec(piece);
    if (!match) {
      errors.push(`Could not read "${piece}". Try something like "Tue 6 to 8 PM".`);
      continue;
    }
    const weekday = WEEKDAY_NAMES.indexOf(match[1].toLowerCase());
    const startMeridiem = meridiemOf(match[4]);
    const endMeridiem = meridiemOf(match[7]);
    const guess = (hour: number): "am" | "pm" => (hour >= 8 && hour <= 11 ? "am" : "pm");
    const startHour = Number(match[2]);
    const endHour = Number(match[5]);
    // A start with no marker takes the end's, unless that would put it after the end: "11 to 1 PM" starts in the morning.
    const startFallback = endMeridiem === null ? guess(startHour) : startHour % 12 > endHour % 12 ? (endMeridiem === "pm" ? "am" : "pm") : endMeridiem;
    const start = hourOn(startHour, Number(match[3] ?? 0), startMeridiem, startFallback);
    let end = hourOn(endHour, Number(match[6] ?? 0), endMeridiem, startMeridiem ?? guess(endHour));
    if (start === null || end === null) {
      errors.push(`"${piece}" has a time that is not a time.`);
      continue;
    }
    // "11 to 1 PM" reads across noon: an end before the start with no marker of its own moves to the afternoon.
    if (end <= start && endMeridiem === null) end += 12;
    const dayOffset = daysUntil(today.weekday, weekday, true);
    const first = today.midnight + dayOffset * DAY_MS;
    const startMs = first + Math.round(start * 60) * 60_000;
    const endMs = first + Math.round(end * 60) * 60_000;
    // The same weekday as today but already past: the next one, a week on (which then falls outside the week).
    const shifted = startMs <= nowMs && dayOffset === 0 ? [startMs + 7 * DAY_MS, endMs + 7 * DAY_MS] : [startMs, endMs];
    if (shifted[1] - shifted[0] < MIN_FREE_MS) {
      errors.push(`"${piece}" is shorter than an hour. Give it at least an hour.`);
    } else if (!fitsTheWeek(shifted[0], shifted[1], nowMs)) {
      errors.push(`"${piece}" is not inside the next 7 days.`);
    } else {
      windows.push(windowAt(shifted[0], shifted[1]));
    }
  }
  return { windows, errors };
}

export type FreeInput = { chips: FreeChipId[]; text: string; feels: string };

export type FreeResult = { ok: true; windows: FreeWindow[]; feels: string | null } | { ok: false; message: string };

/**
 * The windows to post: the chosen chips and the typed ones, in time order, overlapping ones merged, at least one and at
 * most 8. A line the parser could not read is an error rather than a silent drop, so the person fixes it.
 */
export function freeWindowsFor(input: FreeInput, nowIso: string): FreeResult {
  const offered = freeChips(nowIso);
  const chosen = offered.filter((chip) => input.chips.includes(chip.id)).map((chip) => chip.window);
  const typed = parseFreeText(input.text, nowIso);
  if (typed.errors.length > 0) return { ok: false, message: typed.errors[0] };
  const merged = mergeWindows([...chosen, ...typed.windows]);
  if (merged.length === 0) return { ok: false, message: "Pick at least one time you are free." };
  if (merged.length > MAX_FREE_WINDOWS) return { ok: false, message: `That is more than ${MAX_FREE_WINDOWS} windows. Keep the ones that matter.` };
  const feels = input.feels.trim().slice(0, FEELS_MAX);
  return { ok: true, windows: merged, feels: feels === "" ? null : feels };
}

/** Sorted by start, with windows that overlap or touch joined into one. */
export function mergeWindows(windows: FreeWindow[]): FreeWindow[] {
  const sorted = [...windows].sort((first, second) => toMs(first.start) - toMs(second.start));
  const merged: FreeWindow[] = [];
  for (const window of sorted) {
    const last = merged.at(-1);
    if (last && toMs(window.start) <= toMs(last.end)) {
      if (toMs(window.end) > toMs(last.end)) last.end = window.end;
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

/** "Tue evening, Sat afternoon": what the person said, in their own kind of words, for the note in the thread. */
export function describeFree(windows: FreeWindow[]): string {
  const parts = windows.map((window) => {
    const startMs = toMs(window.start);
    const day = centralDay(startMs);
    const hour = (startMs - day.midnight) / HOUR_MS;
    const word = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
    return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day.weekday]} ${word}`;
  });
  return [...new Set(parts)].join(", ");
}

/**
 * What to do with the answer to posting someone's week: it is saved, it was refused and the person fixes it (the
 * server's plain message), or the route is not there yet and onboarding goes on with the times kept for a retry.
 */
export function availabilityOutcome(result: { ok: true } | { ok: false; message: string; missing?: boolean }): { kind: "saved" } | { kind: "unsaved" } | { kind: "refused"; message: string } {
  if (result.ok) return { kind: "saved" };
  return result.missing ? { kind: "unsaved" } : { kind: "refused", message: result.message };
}
