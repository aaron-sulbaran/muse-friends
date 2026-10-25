import type { Category, PlanState } from "./types";

/*
 * Names for the values defined in app/globals.css. Hex and font values live
 * only there; this file gives JavaScript the same names (as var() references)
 * plus the few numbers that are not CSS tokens.
 */
export const color = {
  screen: "var(--color-screen)",
  surface: "var(--color-surface)",
  group: "var(--color-group)",
  muted: "var(--color-muted)",
  faint: "var(--color-faint)",
  accent: "var(--color-accent)",
  tracking: "var(--color-tracking)",
  withheld: "var(--color-withheld)",
  sprout: "var(--color-sprout)",
  sproutLeaf: "var(--color-sprout-leaf)",
  mochi: "var(--color-mochi)",
} as const;

export const motionMs = {
  rowIn: 220,
  cardIn: 280,
  pop: 320,
  drawer: 260,
} as const;

export const pollIntervalMs = 1000;

/** Phone screen proportions: 390 by 844. */
export const phone = {
  width: 390,
  height: 844,
  bezel: 10,
  /** Below this viewport width a phone route renders full-bleed with no frame. */
  fullBleedBelow: 600,
} as const;

/** The simulated friend who stands in for side b when one judge plays alone. */
export const simulatedFriend = { human: "Michelle", muse: "Michelle's Muse" } as const;

/** The third person of a plan for three, fictional in every room: Kai, whose Muse is Pebble. A model plays Kai when one judge plays alone. */
export const simulatedMember = { human: "Kai", muse: "Pebble" } as const;

export const categoryLabel: Record<Category, string> = {
  food: "food",
  events: "events",
  availability: "times",
  location: "location",
  interests: "interests",
};

/** Lifecycle steps shown in the stepper, in order. `dropped` is a branch, not a step. */
export const lifecycleSteps: ReadonlyArray<{ state: Exclude<PlanState, "dropped">; label: string }> = [
  { state: "detected", label: "Found" },
  { state: "negotiating", label: "Talking" },
  { state: "awaiting_humans", label: "Your call" },
  { state: "confirmed", label: "Confirmed" },
  { state: "scheduled", label: "On calendar" },
  { state: "reminded", label: "Reminded" },
  { state: "happened", label: "Happened" },
  { state: "followed_up", label: "Made it?" },
];
