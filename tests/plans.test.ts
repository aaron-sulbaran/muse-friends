import { describe, expect, it } from "vitest";
import { InvalidTransitionError, PLAN_TRANSITIONS, canTransition, isTerminal, transitionPlan } from "@/lib/plans";
import { PLAN_STATES, type Plan, type PlanState } from "@/lib/protocol";

function plan(state: PlanState = "detected"): Plan {
  return {
    id: "plan_1",
    contextId: "ctx_1",
    initiator: "aaron",
    participants: ["aaron", "lisa"],
    state,
    decisions: { aaron: "pending", lisa: "pending" },
    history: [{ state: "detected", at: "2026-10-25T14:00:00-05:00" }],
    createdAt: "2026-10-25T14:00:00-05:00",
    updatedAt: "2026-10-25T14:00:00-05:00",
  };
}

const at = "2026-10-25T14:01:00-05:00";

describe("plan lifecycle", () => {
  it("walks the happy path in order, recording history", () => {
    const order: PlanState[] = ["negotiating", "awaiting_humans", "confirmed", "scheduled", "reminded", "happened", "followed_up"];
    let current = plan();
    for (const next of order) current = transitionPlan(current, next, at);
    expect(current.state).toBe("followed_up");
    expect(current.history.map((entry) => entry.state)).toEqual(["detected", ...order]);
    expect(isTerminal("followed_up")).toBe(true);
  });

  it("allows dropping while the plan is still being decided, and records why", () => {
    for (const from of ["detected", "negotiating", "awaiting_humans"] as const) {
      const dropped = transitionPlan(plan(from), "dropped", at, { dropReason: "declined", note: "a person said no" });
      expect(dropped).toMatchObject({ state: "dropped", dropReason: "declined" });
      expect(dropped.history.at(-1)).toMatchObject({ state: "dropped", note: "a person said no" });
    }
  });

  it("throws on every move the table does not allow", () => {
    for (const from of PLAN_STATES) {
      for (const to of PLAN_STATES) {
        if (canTransition(from, to)) continue;
        expect(() => transitionPlan(plan(from), to, at), `${from} -> ${to}`).toThrow(InvalidTransitionError);
      }
    }
  });

  it("cannot skip ahead, go backward, or leave a terminal state", () => {
    expect(() => transitionPlan(plan("detected"), "awaiting_humans", at)).toThrow("plan cannot move from detected to awaiting_humans");
    expect(() => transitionPlan(plan("scheduled"), "confirmed", at)).toThrow(InvalidTransitionError);
    expect(() => transitionPlan(plan("dropped"), "negotiating", at)).toThrow(InvalidTransitionError);
    expect(() => transitionPlan(plan("followed_up"), "dropped", at)).toThrow(InvalidTransitionError);
    expect(() => transitionPlan(plan("confirmed"), "dropped", at)).toThrow(InvalidTransitionError);
  });

  it("only dropped and followed_up are terminal", () => {
    expect(PLAN_STATES.filter(isTerminal)).toEqual(["followed_up", "dropped"]);
    expect(Object.keys(PLAN_TRANSITIONS).sort()).toEqual([...PLAN_STATES].sort());
  });

  it("does not mutate the plan it was given", () => {
    const original = plan();
    transitionPlan(original, "negotiating", at);
    expect(original.state).toBe("detected");
    expect(original.history).toHaveLength(1);
  });
});
