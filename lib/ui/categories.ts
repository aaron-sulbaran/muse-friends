import type { Category, ShareTier } from "./types";

/*
 * What the sharing switches are called, said in what a person shares rather than in protocol words. One list for both
 * sheets that edit the same settings (the avatar sheet and the onboarding's share sheet), so a label never differs.
 */

export type CategoryRow = { value: Category; label: string; line: string };

/** The four switches a person can flip, in the order they are shown. */
export const SWITCH_ROWS: ReadonlyArray<CategoryRow> = [
  { value: "food", label: "Restaurants and food", line: "Places you saved, and what you like to eat" },
  { value: "location", label: "Cities and where I am", line: "Your city or neighborhood, never an exact spot" },
  { value: "events", label: "Events", line: "Shows and plans you saved" },
  { value: "interests", label: "Interests", line: "What you like, in a few words" },
];

/** Free times are the one thing the Muses need to find a day, so they are always included and never a switch. */
export const FREE_TIMES_LINE = "Free times are always included: open windows only, never what is in them.";

/** Already true in code: the policy scans notes for private event titles before anything is sent. */
export const EVENT_NAMES_LINE = "Calendar event names are never shared.";

/** What each tier is called wherever a person picks or reads one. */
export const TIER_LABELS: Record<ShareTier, string> = { close: "Close friend", friend: "Friend", off: "Off" };
