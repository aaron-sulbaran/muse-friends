import type { DropReason, Plan, PlanState } from "@/lib/protocol";

// The plan lifecycle as a pure transition table. Invalid transitions throw.
//
// detected -> negotiating -> awaiting_humans -> confirmed -> scheduled -> reminded -> happened -> followed_up
//        \-> dropped    \-> dropped        \-> dropped (a human declined)
export const PLAN_TRANSITIONS: Record<PlanState, PlanState[]> = {
  detected: ["negotiating", "dropped"],
  negotiating: ["awaiting_humans", "dropped"],
  awaiting_humans: ["confirmed", "dropped"],
  confirmed: ["scheduled"],
  scheduled: ["reminded"],
  reminded: ["happened"],
  happened: ["followed_up"],
  followed_up: [],
  dropped: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    readonly from: PlanState,
    readonly to: PlanState,
  ) {
    super(`plan cannot move from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function canTransition(from: PlanState, to: PlanState): boolean {
  return PLAN_TRANSITIONS[from].includes(to);
}

export function transitionPlan(
  plan: Plan,
  to: PlanState,
  at: string,
  options: { note?: string; dropReason?: DropReason } = {},
): Plan {
  if (!canTransition(plan.state, to)) throw new InvalidTransitionError(plan.state, to);
  return {
    ...plan,
    state: to,
    updatedAt: at,
    dropReason: to === "dropped" ? (options.dropReason ?? plan.dropReason) : plan.dropReason,
    history: [...plan.history, { state: to, at, note: options.note }],
  };
}

export function isTerminal(state: PlanState): boolean {
  return PLAN_TRANSITIONS[state].length === 0;
}
