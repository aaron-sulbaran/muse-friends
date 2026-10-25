import { describe, expect, it } from "vitest";
import { viewForRole } from "@/lib/ui/chat";
import {
  buildFixtureSnapshot,
  derivePlanState,
  initialFixtureState,
  reduceFixture,
  type FixtureAction,
  type FixtureState,
} from "@/lib/ui/fixture";

function run(actions: FixtureAction[], from: FixtureState = initialFixtureState()): FixtureState {
  return actions.reduce(reduceFixture, from);
}

const toAwaitingHumans: FixtureAction[] = [
  { type: "load_reel" },
  { type: "next_message" },
  { type: "next_message" },
  { type: "next_message" },
  { type: "next_message" },
];

describe("recorded run lifecycle", () => {
  it("opens on the dead reel with nothing counted", () => {
    const snapshot = buildFixtureSnapshot(initialFixtureState());
    expect(snapshot.plan).toBeNull();
    expect(snapshot.followThrough.events).toHaveLength(0);
    expect(snapshot.messages).toHaveLength(0);
  });

  it("walks detected, negotiating, awaiting_humans as messages arrive", () => {
    expect(derivePlanState(run([{ type: "load_reel" }]))).toBe("detected");
    expect(derivePlanState(run([{ type: "load_reel" }, { type: "next_message" }]))).toBe("negotiating");
    expect(derivePlanState(run(toAwaitingHumans))).toBe("awaiting_humans");
  });

  it("needs both humans before confirming, then the handoff before scheduling", () => {
    const aYes = run([...toAwaitingHumans, { type: "decide", role: "a", choice: "accept" }]);
    expect(derivePlanState(aYes)).toBe("awaiting_humans");
    const bothYes = reduceFixture(aYes, { type: "decide", role: "b", choice: "accept" });
    expect(derivePlanState(bothYes)).toBe("confirmed");
    expect(derivePlanState(reduceFixture(bothYes, { type: "handoff" }))).toBe("scheduled");
  });

  it("drops the plan when either human declines", () => {
    expect(derivePlanState(run([...toAwaitingHumans, { type: "decide", role: "b", choice: "decline" }]))).toBe("dropped");
  });

  it("ignores decisions outside awaiting_humans", () => {
    const early = run([{ type: "load_reel" }, { type: "decide", role: "a", choice: "accept" }]);
    expect(early.decisions.a).toBe("pending");
  });

  it("jumps the clock to the reminder, then to the next day", () => {
    const scheduled = run([
      ...toAwaitingHumans,
      { type: "decide", role: "a", choice: "accept" },
      { type: "decide", role: "b", choice: "accept" },
      { type: "handoff" },
    ]);
    const reminded = reduceFixture(scheduled, { type: "clock_next" });
    expect(derivePlanState(reminded)).toBe("reminded");
    expect(buildFixtureSnapshot(reminded).clockSimulated).toBe(true);
    const followedUp = reduceFixture(reminded, { type: "clock_next" });
    expect(derivePlanState(followedUp)).toBe("followed_up");
  });
});

describe("follow-through counts human events only", () => {
  it("never counts agent messages, however many arrive", () => {
    const snapshot = buildFixtureSnapshot(run(toAwaitingHumans));
    expect(snapshot.followThrough.agentMessageCount).toBe(4);
    expect(snapshot.followThrough.events).toHaveLength(0);
  });

  it("counts each human yes, the handoff, and showing up", () => {
    const state = run([
      ...toAwaitingHumans,
      { type: "decide", role: "a", choice: "accept" },
      { type: "decide", role: "b", choice: "accept" },
      { type: "handoff" },
      { type: "clock_next" },
      { type: "clock_next" },
    ]);
    expect(buildFixtureSnapshot(state).followThrough.events.map((event) => event.label)).toEqual([
      "Aaron said yes",
      "Lisa said yes",
      "Aaron took the draft to WhatsApp",
      "Showed up (simulated clock)",
    ]);
  });
});

describe("what each phone shows", () => {
  it("keeps the agents' back-and-forth out of the chat", () => {
    const view = viewForRole(buildFixtureSnapshot(run(toAwaitingHumans)), "a");
    const text = JSON.stringify(view.items);
    expect(text).not.toContain("intent");
    expect(text).not.toContain("counter");
    expect(view.items.filter((item) => item.kind === "plan-card")).toHaveLength(1);
  });

  it("shows one live card per human and collapses it after a yes", () => {
    const awaiting = buildFixtureSnapshot(run(toAwaitingHumans));
    expect(viewForRole(awaiting, "a").status).toBe("⏳ waiting for you");
    const aYes = buildFixtureSnapshot(run([...toAwaitingHumans, { type: "decide", role: "a", choice: "accept" }]));
    const view = viewForRole(aYes, "a");
    expect(view.items.some((item) => item.kind === "plan-card")).toBe(false);
    expect(view.items.some((item) => item.kind === "collapsed")).toBe(true);
    expect(view.status).toBe("⏳ waiting for Lisa");
    expect(viewForRole(aYes, "b").items.some((item) => item.kind === "plan-card")).toBe(true);
  });

  it("gives only the initiator the draft card; the friend is told it is coming", () => {
    const confirmed = buildFixtureSnapshot(
      run([...toAwaitingHumans, { type: "decide", role: "a", choice: "accept" }, { type: "decide", role: "b", choice: "accept" }]),
    );
    expect(viewForRole(confirmed, "a").items.some((item) => item.kind === "draft-card")).toBe(true);
    expect(viewForRole(confirmed, "b").items.some((item) => item.kind === "draft-card")).toBe(false);
  });

  it("says the place was kept private when location is withheld", () => {
    const withheld = buildFixtureSnapshot(run([{ type: "set_location", shared: false }, ...toAwaitingHumans]));
    expect(withheld.plan?.place).toBeNull();
    expect(withheld.messages[1]?.removed).toContain("location");
  });

  it("labels the simulated friend instead of Lisa's Muse", () => {
    const snapshot = buildFixtureSnapshot(run([{ type: "set_simulated", value: true }, ...toAwaitingHumans]));
    expect(viewForRole(snapshot, "b").museName).toBe("Michelle's Muse");
    expect(viewForRole(snapshot, "a").friendMuseName).toBe("Michelle's Muse");
  });
});
