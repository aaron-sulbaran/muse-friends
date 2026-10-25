import { describe, expect, it } from "vitest";
import { viewForRole } from "@/lib/ui/chat";
import { buildStateSnapshot, derivePlanState, initialScriptState, reduceScript, type ScriptAction, type ScriptState } from "@/lib/ui/script";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import type { UiSnapshot } from "@/lib/ui/types";

function run(actions: ScriptAction[], from: ScriptState = initialScriptState()): ScriptState {
  return actions.reduce(reduceScript, from);
}

function ui(state: ScriptState): UiSnapshot {
  return toUiSnapshot(buildStateSnapshot(state), { mode: state.mode });
}

const sixMessages: ScriptAction[] = Array.from({ length: 6 }, () => ({ type: "next_message" }) as const);
const toAwaitingHumans: ScriptAction[] = [{ type: "load_reel" }, ...sixMessages];
const bothYes: ScriptAction[] = [
  ...toAwaitingHumans,
  { type: "decide", role: "a", choice: "accept" },
  { type: "decide", role: "b", choice: "accept" },
];

describe("the recorded run, stage by stage", () => {
  it("says Replay, because the script plays a recording", () => {
    expect(ui(initialScriptState()).mode).toBe("replay");
    expect(ui(run(toAwaitingHumans)).mode).toBe("replay");
  });

  it("opens on the dead reel with nothing counted", () => {
    const snapshot = ui(initialScriptState());
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
    const both = reduceScript(aYes, { type: "decide", role: "b", choice: "accept" });
    expect(derivePlanState(both)).toBe("confirmed");
    expect(derivePlanState(reduceScript(both, { type: "handoff" }))).toBe("scheduled");
  });

  it("drops the plan when either human declines", () => {
    expect(derivePlanState(run([...toAwaitingHumans, { type: "decide", role: "b", choice: "decline" }]))).toBe("dropped");
  });

  it("ignores decisions outside awaiting_humans", () => {
    expect(run([{ type: "load_reel" }, { type: "decide", role: "a", choice: "accept" }]).decisions.a).toBe("pending");
  });

  it("jumps the clock to the reminder, then to the next day", () => {
    const scheduled = run([...bothYes, { type: "handoff" }]);
    const reminded = reduceScript(scheduled, { type: "clock_next" });
    expect(derivePlanState(reminded)).toBe("reminded");
    expect(ui(reminded).clockSimulated).toBe(true);
    expect(derivePlanState(reduceScript(reminded, { type: "clock_next" }))).toBe("followed_up");
  });

  it("shows the thinking row while a turn is in flight and clears it at awaiting_humans", () => {
    const midway = ui(run([{ type: "load_reel" }, { type: "next_message" }, { type: "next_message" }]));
    expect(midway.inFlight).toEqual({ agent: "aaron" });
    expect(ui(run(toAwaitingHumans)).inFlight).toBeNull();
  });
});

describe("follow-through counts one thing: plans that happened", () => {
  it("never counts agent messages, the reel arriving, or taps and sends", () => {
    const snapshot = ui(run(bothYes));
    expect(snapshot.followThrough.agentMessageCount).toBe(6);
    expect(snapshot.followThrough.humanTapCount).toBe(2);
    expect(snapshot.followThrough.events).toHaveLength(0);
    expect(ui(run([...bothYes, { type: "handoff" }])).followThrough.humanTapCount).toBe(3);
  });

  it("reads 0 on the dead reel and after the handoff, and 1 once the plan has happened", () => {
    expect(ui(initialScriptState()).followThrough.events).toHaveLength(0);
    const scheduled = run([...bothYes, { type: "handoff" }]);
    expect(ui(scheduled).followThrough.events).toHaveLength(0);
    const reminded = reduceScript(scheduled, { type: "clock_next" });
    expect(ui(reminded).followThrough.events).toHaveLength(0);
    const nextDay = reduceScript(reminded, { type: "clock_next" });
    expect(ui(nextDay).followThrough.events.map((event) => event.label)).toEqual(["Sprout and Mochi got shawarma together"]);
  });
});

describe("the privacy switch replays the propose", () => {
  it("withholds location from a propose delivered after the switch", () => {
    const state = run([{ type: "load_reel" }, { type: "set_policy", category: "location", on: false }, ...sixMessages]);
    const snapshot = ui(state);
    expect(snapshot.messages[1].removed).toContain("location");
    expect(snapshot.messages[1].shared).not.toContain("location");
    expect(snapshot.plan?.place).toBeNull();
    expect(snapshot.messages).toHaveLength(6);
  });

  it("sends the propose again, with the withheld stamp, when the switch flips after it arrived", () => {
    const flipped = run([...toAwaitingHumans, { type: "set_policy", category: "location", on: false }]);
    const snapshot = ui(flipped);
    expect(snapshot.messages).toHaveLength(7);
    expect(snapshot.messages[1].removed).toEqual([]);
    const replay = snapshot.messages[6];
    expect(replay).toMatchObject({ id: snapshot.messages[1].id, replayed: true, type: "propose" });
    expect(replay.removed).toEqual(["location"]);
    expect(snapshot.plan?.place).toBeNull();
    expect(snapshot.sharing.lisa.categories.location).toBe(false);
  });

  it("replays again, with nothing withheld, when the switch flips back on", () => {
    const state = run([
      ...toAwaitingHumans,
      { type: "set_policy", category: "location", on: false },
      { type: "set_policy", category: "location", on: true },
    ]);
    const snapshot = ui(state);
    expect(snapshot.messages).toHaveLength(8);
    expect(snapshot.messages[7].removed).toEqual([]);
    expect(snapshot.plan?.place).toBe("E 6th St");
  });

  it("does not replay once a person has answered", () => {
    const answered = run([...toAwaitingHumans, { type: "decide", role: "a", choice: "accept" }]);
    // awaiting_humans still holds until both answer, so a change here still replays; after both yes it must not.
    const confirmed = run([...bothYes, { type: "set_policy", category: "location", on: false }]);
    expect(ui(answered).messages).toHaveLength(6);
    expect(ui(confirmed).messages).toHaveLength(6);
  });
});

describe("what each phone shows", () => {
  it("keeps the agents' back-and-forth out of the chat", () => {
    const view = viewForRole(ui(run(toAwaitingHumans)), "a");
    const text = JSON.stringify(view.items);
    expect(text).not.toContain('"intent"');
    expect(text).not.toContain("counter");
    expect(view.items.filter((item) => item.kind === "plan-card")).toHaveLength(1);
  });

  it("names the place and both Muses by their display names", () => {
    const view = viewForRole(ui(run(toAwaitingHumans)), "a");
    expect(view.museName).toBe("Sprout");
    expect(view.friendMuseName).toBe("Mochi");
    const bubble = view.items.find((item) => item.kind === "bubble" && item.id === "proposal");
    expect(bubble).toMatchObject({ text: "You and Mochi both want to try Shawarma Point, and you're both free Tuesday 6 to 8." });
  });

  it("never shows the internal ids Aaron or Lisa", () => {
    for (const state of [toAwaitingHumans, bothYes, [...bothYes, { type: "handoff" } as const]]) {
      for (const role of ["a", "b"] as const) {
        const text = JSON.stringify(viewForRole(ui(run(state)), role));
        expect(text).not.toMatch(/Aaron|Lisa/);
      }
    }
  });

  it("shows one live card per human and collapses it after a yes", () => {
    expect(viewForRole(ui(run(toAwaitingHumans)), "a").status).toBe("⏳ waiting for you");
    const aYes = ui(run([...toAwaitingHumans, { type: "decide", role: "a", choice: "accept" }]));
    const view = viewForRole(aYes, "a");
    expect(view.items.some((item) => item.kind === "plan-card")).toBe(false);
    expect(view.items.some((item) => item.kind === "collapsed")).toBe(true);
    expect(view.status).toBe("⏳ waiting for Mochi");
    expect(viewForRole(aYes, "b").items.some((item) => item.kind === "plan-card")).toBe(true);
  });

  it("gives only the initiator the draft card; the friend is told it is coming", () => {
    const confirmed = ui(run(bothYes));
    expect(viewForRole(confirmed, "a").items.some((item) => item.kind === "draft-card")).toBe(true);
    expect(viewForRole(confirmed, "b").items.some((item) => item.kind === "draft-card")).toBe(false);
  });

  it("labels the simulated friend instead of Mochi", () => {
    const snapshot = ui(run([{ type: "set_simulated", value: true }, ...toAwaitingHumans]));
    expect(snapshot.simulatedFriend).toBe(true);
    expect(viewForRole(snapshot, "b").museName).toBe("Michelle's Muse");
    expect(viewForRole(snapshot, "a").friendMuseName).toBe("Michelle's Muse");
    expect(viewForRole(snapshot, "a").friendHumanName).toBe("Michelle");
  });
});
