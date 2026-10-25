import type { ChatItem } from "./chat";
import { daySeparatorFor } from "./format";
import type { UiPlan } from "./types";

/*
 * The time skip: once the person adds the calendar hold, the demo clock moves to the day-of reminder,
 * and from the reminder to the next morning's "Did you two make it?" by itself. Before each
 * jump the chat shows a skip card, so a judge who has never seen the demo reads the jump as intentional.
 * Pure, so the timing and the labels are tested without rendering.
 */

/** How long the phone waits on the reminder before skipping to the next morning. */
export const SKIP_AFTER_MS = 4_000;
/** How long the skip card shows before the clock moves, so it is read before the reminder lands under it. */
export const SKIP_BEAT_MS = 1_400;

// The same moments the lifecycle runs (lib/agent/lifecycle.ts momentOf): two hours before, and 14 hours after the end.
const HOUR_MS = 3_600_000;
const REMINDER_LEAD_HOURS = 2;
const FOLLOW_UP_AFTER_HOURS = 14;

/** The state a skip leaves from; the clock route moves only a plan still in it, so many phones can ask at once. */
export type SkipFrom = "scheduled" | "reminded";

/** The separator each skip brings: leaving "scheduled" lands on the reminder, leaving "reminded" on the next morning. */
export const SKIP_SEPARATOR_FOR: Record<SkipFrom, string> = { scheduled: "sep-reminded", reminded: "sep-followup" };

/** The separators the chat draws at each jump; the phone draws them as skip cards. */
export const SKIP_SEPARATOR_IDS: ReadonlySet<string> = new Set(["sep-reminded", "sep-followup"]);

/** Items that arrive under a skip card: they wait a beat, so the card lands first. */
export const AFTER_SKIP_IDS: ReadonlySet<string> = new Set(["reminder", "followup", "outcome-replies"]);

/** How far apart two skips land on one phone, even when it learns of both at once (a slow poll, a tab that slept). */
export const SKIP_SPACING_MS = SKIP_AFTER_MS;

/** How many skip cards the chat holds, in order. */
export function skipCount(items: ChatItem[]): number {
  return items.filter((item) => item.kind === "separator" && SKIP_SEPARATOR_IDS.has(item.id)).length;
}

/** The chat as a phone shows it with `revealed` skips on screen: everything from the next skip card on waits its turn. */
export function throughSkips(items: ChatItem[], revealed: number): ChatItem[] {
  let seen = 0;
  const cut = items.findIndex((item) => item.kind === "separator" && SKIP_SEPARATOR_IDS.has(item.id) && seen++ === revealed);
  return cut === -1 ? items : items.slice(0, cut);
}

/** Which skip is due on this phone now, from what its chat shows: the hold row, or the reminder. Null when none. */
export function skipDue(plan: UiPlan | null, items: ChatItem[]): SkipFrom | null {
  if (!plan?.window) return null;
  if (plan.state === "scheduled" && items.some((item) => item.kind === "hold-row")) return "scheduled";
  if (plan.state === "reminded" && items.some((item) => item.id === "reminder")) return "reminded";
  return null;
}

/** Only the reminder moves on by itself; the skip to the reminder waits for the person to add the hold to a calendar. */
export function skipsByItself(from: SkipFrom): boolean {
  return from === "reminded";
}

/** Where a skip lands, in the chat's own words: "Tuesday" and "4:00 PM". */
export function skipTarget(plan: UiPlan, from: SkipFrom): { day: string; time: string } | null {
  if (!plan.window) return null;
  const at =
    from === "scheduled"
      ? new Date(plan.window.start).getTime() - REMINDER_LEAD_HOURS * HOUR_MS
      : new Date(plan.window.end).getTime() + FOLLOW_UP_AFTER_HOURS * HOUR_MS;
  const iso = new Date(at).toISOString();
  return { day: daySeparatorFor(iso, "2000-01-01T00:00:00Z").day, time: daySeparatorFor(iso, iso).time };
}
