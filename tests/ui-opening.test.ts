import { describe, expect, it } from "vitest";
import { PLAN_STATES, type PlanState, type StateSnapshot } from "@/lib/protocol";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { openingMoment, readLine } from "@/lib/ui/opening";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import type { UiSnapshot } from "@/lib/ui/types";

const live = { mode: "live" } as const;
const read = { place: "Shawarma Point", area: "Eastside", hours: "Open until 9, closed Sundays" };

function at(state: PlanState, change: (snapshot: StateSnapshot) => void = () => undefined): UiSnapshot {
  const snapshot = snapshotAtPlanState(state);
  change(snapshot);
  return toUiSnapshot(snapshot, live);
}

describe("what Sprout read from the caption", () => {
  it("says the place, where it is, and when it is open, in one sentence", () => {
    expect(readLine(read)).toBe("Shawarma Point on Eastside. Open until 9, closed Sundays.");
  });

  it("uses whatever fields the model found, with no stray punctuation", () => {
    expect(readLine({ place: "Shawarma Point", area: null, hours: null })).toBe("Shawarma Point.");
    expect(readLine({ place: "Shawarma Point", area: "Eastside", hours: null })).toBe("Shawarma Point on Eastside.");
    expect(readLine({ place: "Shawarma Point", area: null, hours: "open until 9." })).toBe("Shawarma Point. Open until 9.");
  });

  it("says nothing until a place was read", () => {
    expect(readLine(null)).toBeNull();
    expect(readLine({ place: null, area: "Eastside", hours: "Open late" })).toBeNull();
  });

  it("comes from the latest reel the model has read, as structured fields", () => {
    const withRead = at("negotiating", (snapshot) => {
      snapshot.signals = snapshot.signals.map((signal) => ({ ...signal, extracted: { source: "caption_model" as const, model: "m", ...{ place: read.place, area: read.area, hours: read.hours }, at: signal.receivedAt } }));
    });
    expect(withRead.reelRead).toEqual(read);
    const unread = at("negotiating", (snapshot) => {
      for (const signal of snapshot.signals) delete signal.extracted;
    });
    expect(unread.reelRead).toBeNull();
  });
});

describe("the opening moment, in the order it happens", () => {
  it("names who sent the reel, and keeps the reel compact when there is no live embed", () => {
    const moment = openingMoment(at("negotiating"), "Michelle");
    expect(moment.senderLine).toBe("Michelle sent you a reel");
    expect(moment.reel).toEqual({ compact: true, live: false });
    expect(moment.teammateLine).toBeNull();
  });

  it("credits a teammate's real reel, never the friend, and gives it the room of an embed", () => {
    const withLive: UiSnapshot = { ...at("negotiating"), reel: { username: "slowweekends.tx", caption: "cabin", permalink: "https://www.instagram.com/reel/x/", thumbnailUrl: null } };
    const moment = openingMoment(withLive, "Michelle");
    expect(moment.teammateLine).toBe("A teammate's reel, read live from Instagram");
    expect(moment.reel).toEqual({ compact: false, live: true });
    expect(moment.senderLine).not.toMatch(/Lisa/);
  });

  it("while the Muses talk: the reel, Sprout's read and [talking], with no offer and no plan card", () => {
    for (const state of ["detected", "negotiating"] as const) {
      const moment = openingMoment({ ...at(state), reelRead: read }, "Michelle");
      expect(moment.read).toBe("Shawarma Point on Eastside. Open until 9, closed Sundays.");
      expect(moment.offer).toBeNull();
      expect(moment.plan).toBeNull();
      expect(moment.status).toMatchObject({ glyph: "talking" });
    }
  });

  it("holds the offer back until the Muses have agreed, in every state before awaiting_humans", () => {
    for (const state of PLAN_STATES) {
      const moment = openingMoment(at(state), "Michelle");
      const agreed = state === "awaiting_humans";
      expect(moment.offer !== null).toBe(agreed);
      expect(moment.plan !== null).toBe(agreed);
    }
  });

  it("once they agreed: the offer with the time, the plan card with the friend's Muse already in, and [waiting-you]", () => {
    const snapshot = at("awaiting_humans", (state) => (state.room = { ...state.room, simulatedFriend: true }));
    const moment = openingMoment({ ...snapshot, reelRead: read }, "Michelle");
    expect(moment.offer).toMatch(/^You and Michelle are both free .+ to .+\. Want me to set it up\?$/);
    expect(moment.plan).toEqual({ title: `${snapshot.plan!.activityTitle} with Michelle`, museIsIn: "Michelle's Muse is in", notNow: "Not now", setItUp: "Set it up" });
    expect(moment.status).toEqual({ glyph: "waiting-you", text: "waiting for you" });
  });

  it("stops saying waiting for you once the person has said yes", () => {
    const accepted = at("awaiting_humans");
    const moment = openingMoment({ ...accepted, plan: { ...accepted.plan!, decisions: { a: "accepted", b: "pending" } } }, "Michelle");
    expect(moment.status).toBeNull();
  });

  it("has no emoji and no em dash anywhere in what it says", () => {
    const moment = openingMoment({ ...at("awaiting_humans"), reelRead: read }, "Michelle");
    const text = JSON.stringify(moment);
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text).not.toMatch(/—|–/);
  });
});
