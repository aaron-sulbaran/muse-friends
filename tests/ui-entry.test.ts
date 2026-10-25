import { describe, expect, it } from "vitest";
import { friendLink, phoneRootHref, runInProgress, wantsSimulatedFriend } from "@/lib/ui/entry";
import type { PlanState, UiPlan } from "@/lib/ui/types";

describe("how a phone gets in", () => {
  it("goes straight to Sprout's side of its own room, with the simulated friend on", () => {
    const href = phoneRootHref("k3x9qa");
    expect(href).toBe("/a?room=k3x9qa&friend=1");
    expect(wantsSimulatedFriend(new URL(href, "https://example.test").search)).toBe(true);
  });

  it("gives the friend a link to Mochi's side of the same room, and does not ask for Michelle", () => {
    const link = friendLink("https://musefriends.tech", "k3x9qa");
    expect(link).toBe("https://musefriends.tech/b?room=k3x9qa");
    expect(wantsSimulatedFriend(new URL(link).search)).toBe(false);
  });

  it("acts on the simulated-friend flag only when the address asks for it", () => {
    expect(wantsSimulatedFriend("")).toBe(false);
    expect(wantsSimulatedFriend("?friend=0")).toBe(false);
    expect(wantsSimulatedFriend("?room=k3x9qa")).toBe(false);
  });
});

const planIn = (state: PlanState) => ({ state }) as UiPlan;

describe("when a judge arriving may reset the room", () => {
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
