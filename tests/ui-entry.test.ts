import { afterEach, describe, expect, it, vi } from "vitest";
import { friendLink, markMichelleSeen, needsMichelleOnLoad, phoneRootHref, runInProgress, wantsSimulatedFriend, wasMichelleSeen } from "@/lib/ui/entry";
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

describe("a fresh phone room with no friend", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stubStorage = () => {
    const items = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) });
  };

  it("turns Michelle on at first load when there is no plan and she is off", () => {
    expect(needsMichelleOnLoad({ plan: null, simulatedFriend: false }, false)).toBe(true);
  });

  it("leaves her alone when she is already on, a run is going, or this tab has seen her on", () => {
    expect(needsMichelleOnLoad({ plan: null, simulatedFriend: true }, false)).toBe(false);
    expect(needsMichelleOnLoad({ plan: { id: "p" } as UiPlan, simulatedFriend: false }, false)).toBe(false);
    expect(needsMichelleOnLoad({ plan: null, simulatedFriend: false }, true)).toBe(false);
  });

  it("remembers per room that this tab has seen her, so an Invite that turned her off is not undone by a reload", () => {
    stubStorage();
    expect(wasMichelleSeen("r1")).toBe(false);
    markMichelleSeen("r1");
    expect(wasMichelleSeen("r1")).toBe(true);
    expect(wasMichelleSeen("r2")).toBe(false);
  });

  it("works with storage blocked: she is simply offered once more", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(wasMichelleSeen("r1")).toBe(false);
    expect(() => markMichelleSeen("r1")).not.toThrow();
  });
});
