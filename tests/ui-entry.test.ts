import { describe, expect, it } from "vitest";
import { otherRole, runInProgress, sideHref, simulatedFriendHref, wantsSimulatedFriend } from "@/lib/ui/entry";
import type { PlanState, UiPlan } from "@/lib/ui/types";

describe("how a phone gets to a side", () => {
  it("links each side to its own phone route", () => {
    expect(sideHref("a")).toBe("/a");
    expect(sideHref("b")).toBe("/b");
  });

  it("switches to the other side", () => {
    expect(otherRole("a")).toBe("b");
    expect(otherRole("b")).toBe("a");
  });

  it("starts the simulated friend only when the address asks for it", () => {
    expect(wantsSimulatedFriend(new URL(simulatedFriendHref, "https://example.test").search)).toBe(true);
    expect(wantsSimulatedFriend("")).toBe(false);
    expect(wantsSimulatedFriend("?friend=0")).toBe(false);
    expect(wantsSimulatedFriend("?other=1")).toBe(false);
  });

  it("sends the simulated friend to side a, the side a lone judge plays", () => {
    expect(simulatedFriendHref.startsWith("/a?")).toBe(true);
  });
});

const planIn = (state: PlanState) => ({ state }) as UiPlan;

describe("when a judge arriving may start a game", () => {
  it("leaves a run that is still going alone", () => {
    for (const state of ["detected", "negotiating", "awaiting_humans", "confirmed", "scheduled", "reminded", "happened"] as const) {
      expect(runInProgress(planIn(state))).toBe(true);
    }
  });

  it("starts fresh over an empty room and over a run that is over", () => {
    expect(runInProgress(null)).toBe(false);
    expect(runInProgress(planIn("dropped"))).toBe(false);
    expect(runInProgress(planIn("followed_up"))).toBe(false);
  });
});
