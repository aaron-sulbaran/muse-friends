import { daySeparatorFor, formatTime, formatWindow } from "./format";
import { lifecycleSteps } from "./tokens";
import type { PlanState, UiPlan } from "./types";

/*
 * The plan as a Goals item: a Tracking row and, inside it, one timeline step
 * per lifecycle state reached. Labels and details are the spec's words; the
 * same labels name the stepper on the stage.
 */

export type GoalContext = {
  /** The other person's name as this phone says it: "Mochi", or "Michelle". */
  friend: string;
  /** Possessive for whose reel it was: "Mochi's" or "your". */
  reelOwner: string;
  /** The two Muses' names, in the order they are named in "are comparing times". */
  muses: [string, string];
};

/** Only a confirmed plan is tracked: before that it is still being worked out in the chat. */
export const trackedStates: ReadonlySet<PlanState> = new Set(["confirmed", "scheduled", "reminded", "happened", "followed_up"]);

export function isTracked(plan: UiPlan | null): plan is UiPlan {
  return plan !== null && trackedStates.has(plan.state);
}

export function goalTitle(plan: UiPlan, friend: string): string {
  return `${plan.activityTitle} with ${friend}`;
}

const labelOf = new Map<PlanState, string>(lifecycleSteps.map((step) => [step.state, step.label]));

export function stepLabel(state: PlanState): string {
  return state === "dropped" ? "Dropped" : (labelOf.get(state) ?? state);
}

function dayAndTime(iso: string): string {
  const { day, time } = daySeparatorFor(iso, "2000-01-01T00:00:00Z");
  return `${day} ${time}`;
}

export function stepDetail(state: PlanState, plan: UiPlan, at: string, context: GoalContext): string {
  switch (state) {
    case "detected":
      return plan.target ? `You asked to follow up with ${context.friend}` : `From ${context.reelOwner} reel`;
    case "negotiating":
      return `${context.muses[0]} and ${context.muses[1]} are comparing times`;
    case "awaiting_humans":
      return `Waiting for you and ${context.friend}`;
    case "confirmed":
      return "You both said yes";
    case "scheduled":
      return plan.window ? formatWindow(plan.window) : "Hold added";
    case "reminded":
    case "happened":
      return dayAndTime(at);
    case "followed_up":
      return "Asked about next month";
    case "dropped":
      return plan.droppedReason ?? "The plan ended";
  }
}

export type GoalStep = { state: PlanState; label: string; detail: string; time: string };

/** What the outcome changes about the last step: the goal is Done only on a human "We went!". */
function outcomeWords(plan: UiPlan): { label: string; detail: string } | null {
  if (plan.outcome?.result === "went") return { label: "Done", detail: "You two made it" };
  if (plan.outcome?.result === "didnt") return { label: "Didn't happen", detail: "It didn't happen this time" };
  if (plan.state === "followed_up") return { label: "Did you make it?", detail: "Asked whether you went" };
  return null;
}

export function goalDone(plan: UiPlan): boolean {
  return plan.outcome?.result === "went";
}

/** One step per state the plan reached, oldest first. */
export function goalSteps(plan: UiPlan, context: GoalContext): GoalStep[] {
  const words = outcomeWords(plan);
  return plan.history.map((entry, index) => {
    const override = words && index === plan.history.length - 1 && (entry.state === "followed_up" || entry.state === "happened") ? words : null;
    return {
      state: entry.state,
      label: override?.label ?? stepLabel(entry.state),
      detail: override?.detail ?? stepDetail(entry.state, plan, entry.at, context),
      time: formatTime(entry.at),
    };
  });
}

/** The row's second line follows where the plan is now; once the hold is on the calendar it says so. */
export function goalRowDetail(plan: UiPlan, context: GoalContext): string {
  const at = plan.history.at(-1)?.at ?? "";
  const words = outcomeWords(plan);
  if (words && (plan.state === "followed_up" || plan.state === "happened")) return words.detail;
  if (plan.state === "scheduled") return `${stepDetail("scheduled", plan, at, context)}, hold added`;
  return stepDetail(plan.state, plan, at, context);
}
