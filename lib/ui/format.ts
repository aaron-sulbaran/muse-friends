import { categoryLabel, simulatedFriend, simulatedMember } from "./tokens";
import type { Category, MemberId, TimeWindow, UiMessage, UiSnapshot } from "./types";

/** Every time the UI shows is Central, matching the event schedule. */
export const displayTimeZone = "America/Chicago";

type Parts = { weekdayShort: string; weekdayLong: string; hour: number; minute: number; meridiem: "AM" | "PM"; second: number; dayKey: string };

function partsOf(iso: string): Parts {
  const date = new Date(iso);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: displayTimeZone,
    weekday: "long",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
  const lookup = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const weekdayLong = lookup.weekday as string;
  return {
    weekdayShort: weekdayLong.slice(0, 3),
    weekdayLong,
    hour: Number(lookup.hour),
    minute: Number(lookup.minute),
    second: Number(lookup.second),
    meridiem: lookup.dayPeriod as "AM" | "PM",
    dayKey: `${lookup.year}-${lookup.month}-${lookup.day}`,
  };
}

function hourText(hour: number, minute: number): string {
  return minute === 0 ? `${hour}` : `${hour}:${String(minute).padStart(2, "0")}`;
}

/** "6:42", for the phone status bar. */
export function formatStatusBarTime(iso: string): string {
  const p = partsOf(iso);
  return `${p.hour}:${String(p.minute).padStart(2, "0")}`;
}

/** "6" or "6:30": the hour without a meridiem, the way a reminder says it. */
export function formatSpokenHour(iso: string): string {
  const p = partsOf(iso);
  return hourText(p.hour, p.minute);
}

/** "8:42 PM". */
export function formatTime(iso: string): string {
  const p = partsOf(iso);
  return `${p.hour}:${String(p.minute).padStart(2, "0")} ${p.meridiem}`;
}

/** "8:42:10 PM", for Activity rows where seconds matter. */
export function formatTimeWithSeconds(iso: string): string {
  const p = partsOf(iso);
  return `${p.hour}:${String(p.minute).padStart(2, "0")}:${String(p.second).padStart(2, "0")} ${p.meridiem}`;
}

/** "Sat 8:42 PM", for the simulated clock label. */
export function formatClockLabel(iso: string): string {
  const p = partsOf(iso);
  return `${p.weekdayShort} ${p.hour}:${String(p.minute).padStart(2, "0")} ${p.meridiem}`;
}

function windowText(window: TimeWindow, dayName: "short" | "long"): string {
  const start = partsOf(window.start);
  const end = partsOf(window.end);
  const day = dayName === "short" ? start.weekdayShort : start.weekdayLong;
  const startText = hourText(start.hour, start.minute);
  const endText = hourText(end.hour, end.minute);
  if (start.meridiem === end.meridiem) {
    return `${day} ${startText} to ${endText} ${end.meridiem}`;
  }
  return `${day} ${startText} ${start.meridiem} to ${endText} ${end.meridiem}`;
}

/** "Tue 6 to 8 PM". */
export function formatWindow(window: TimeWindow): string {
  return windowText(window, "short");
}

/** "Tuesday 6 to 8 PM", for sentences. */
export function formatWindowLong(window: TimeWindow): string {
  return windowText(window, "long");
}

/** "Tuesday 6 to 8", the way the bubbles and draft say it (no meridiem, evenings are assumed in copy). */
export function formatWindowSpoken(window: TimeWindow): string {
  const start = partsOf(window.start);
  const end = partsOf(window.end);
  return `${start.weekdayLong} ${hourText(start.hour, start.minute)} to ${hourText(end.hour, end.minute)}`;
}

/** "Tue, Oct 27, 6 to 8 PM", for the plan card. */
export function formatWindowFull(window: TimeWindow): string {
  const monthDay = new Intl.DateTimeFormat("en-US", { timeZone: displayTimeZone, month: "short", day: "numeric" }).format(
    new Date(window.start),
  );
  const short = windowText(window, "short");
  const [day, ...rest] = short.split(" ");
  return `${day}, ${monthDay}, ${rest.join(" ")}`;
}

export function formatWindowList(windows: TimeWindow[]): string {
  return windows.map(formatWindow).join(" and ");
}

export type DaySeparator = { day: string; time: string };

/** "Today 8:40 PM" or "Tuesday 5:00 PM": the day word is bold in the UI. */
export function daySeparatorFor(iso: string, nowIso: string): DaySeparator {
  const at = partsOf(iso);
  const now = partsOf(nowIso);
  const time = `${at.hour}:${String(at.minute).padStart(2, "0")} ${at.meridiem}`;
  if (at.dayKey === now.dayKey) return { day: "Today", time };
  const yesterday = partsOf(new Date(new Date(nowIso).getTime() - 24 * 60 * 60 * 1000).toISOString());
  if (at.dayKey === yesterday.dayKey) return { day: "Yesterday", time };
  return { day: at.weekdayLong, time };
}

/** Whole seconds between two ISO strings, never negative. */
export function secondsBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000));
}

export function formatLatency(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export type Names = {
  /** The Muse's name as shown on a row or a pill: "Sprout", "Mochi", or "Michelle's Muse". */
  muse: Record<MemberId, string>;
  /** What the other person calls that side in a sentence: "Mochi", or "Michelle". */
  human: Record<MemberId, string>;
};

/** Every visible name comes from the snapshot's persona display names, never from the internal ids. */
export function namesFor(snapshot: Pick<UiSnapshot, "sides" | "simulatedFriend">): Names {
  const simulated = snapshot.simulatedFriend;
  return {
    muse: { aaron: snapshot.sides.aaron, lisa: simulated ? simulatedFriend.muse : snapshot.sides.lisa, kai: snapshot.sides.kai },
    human: { aaron: snapshot.sides.aaron, lisa: simulated ? simulatedFriend.human : snapshot.sides.lisa, kai: simulatedMember.human },
  };
}

const GENERIC_PLACE = /^(the plan|a plan|the spot|this spot|that spot|a spot|the place|this place|that place|a place)$/i;

/** The first row of the plan card: the place from the reel, or "A spot" when the model named none, capitalized. */
export function reelRowTitle(activityTitle: string, reelOwner: string): string {
  const title = activityTitle.trim();
  const named = title === "" || GENERIC_PLACE.test(title) ? "A spot" : `${title.charAt(0).toUpperCase()}${title.slice(1)}`;
  return `${named} from ${reelOwner} reel`;
}

/** "A", "A and B", "A, B, and C": names in a sentence. */
export function listOf(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** Past tense, plain: what the message did. Built from type and fields, never from model text. */
export function messageTitle(message: UiMessage): string {
  const place = message.activity?.title ?? "the plan";
  switch (message.type) {
    case "intent":
      return `Asked about ${place}`;
    case "propose":
      return message.windows?.length ? `Proposed ${formatWindowList(message.windows)}` : "Proposed a plan";
    case "counter":
      return message.windows?.length ? `Countered with ${formatWindowList(message.windows)}` : "Countered";
    case "accept":
      return message.windows?.length ? `Accepted ${formatWindowList(message.windows)}` : "Accepted";
    case "decline":
      return message.reason === "no_overlap" ? "Declined: no time works" : "Declined";
    default:
      return "Sent a message";
  }
}

export type PolicyStamp = {
  shared: string;
  withheld: string | null;
};

/** The stamp is never omitted: a message that shared nothing says so. */
export function policyStampFor(message: UiMessage): PolicyStamp {
  const labels = (categories: Category[]) => categories.map((category) => categoryLabel[category]);
  const sharedAll = new Set<string>(labels(message.shared));
  if (message.windows?.length) sharedAll.add("times");
  const shared = sharedAll.size > 0 ? listOf([...sharedAll]) : "nothing";
  return {
    shared,
    withheld: message.removed.length > 0 ? listOf(labels(message.removed)) : null,
  };
}

/** The accessible name of an Activity row, read by screen readers. */
export function messageAccessibleName(message: UiMessage, names: Names): string {
  const stamp = policyStampFor(message);
  const parts = [
    `${names.muse[message.from]} to ${names.muse[message.to]}`,
    message.type,
    messageTitle(message),
    `shared ${stamp.shared}`,
  ];
  if (stamp.withheld) parts.push(`withheld ${stamp.withheld}`);
  return parts.join(", ");
}
