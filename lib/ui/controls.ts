import type { PlanState, UiReel } from "./types";

/*
 * What the presenter's Demo controls say about themselves: one sentence per control, the scenario list, and the
 * labels that follow the data. Pure, so the words can be tested without rendering.
 */

export type ControlKey = "reset" | "loadReel" | "jump" | "replay" | "leak" | "scenario" | "invite";

/** One plain sentence each. Shown on hover on a laptop and behind an "i" on a phone. */
export const controlInfo: Record<ControlKey, string> = {
  reset: "Resets the whole demo room, so the next run starts clean.",
  loadReel: "Starts the one-to-one scenario: the reel arrives and the two Muses plan.",
  jump: "Moves the demo clock to the reminder, then on to the next day's follow-up.",
  replay: "Plays the labeled recording of a real run, without starting a live one.",
  leak: "Sends two forged messages to the inbox and shows the refusals.",
  scenario: "Picks which demo to run; the other two open after the gate.",
  invite: "The link a friend opens to join this room on their own phone.",
};

/** The reel's real name once a live one has landed (Lisa's Instagram token); the seeded name until then. */
export function loadReelLabel(reel: UiReel | null): string {
  return reel ? `Load @${reel.username}'s reel` : "Load the shawarma reel";
}

export function jumpLabel(state: PlanState | undefined): string {
  return state === "reminded" ? "Jump to next day" : "Jump to reminder";
}

export type Scenario = { id: "one-to-one" | "new-in-town" | "group"; label: string; available: boolean };

/**
 * The three demos. Only one to one has a route on main today; flip `available` as the others land. Each one that
 * is not available shows the note below instead of a button that does nothing.
 */
export const scenarios: readonly Scenario[] = [
  { id: "one-to-one", label: "One to one", available: true },
  { id: "new-in-town", label: "New in town", available: false },
  { id: "group", label: "Group of three", available: true },
];

export const SCENARIO_LOCKED_NOTE = "after the gate";
