import { describe, expect, it } from "vitest";
import { viewForRole } from "@/lib/ui/chat";
import { buildStateSnapshot, derivePlanState, initialScriptState, reduceScript, type ScriptAction, type ScriptState } from "@/lib/ui/script";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import type { UiSnapshot } from "@/lib/ui/types";

function run(actions: ScriptAction[], from: ScriptState = initialScriptState()): ScriptState {
  return actions.reduce(reduceScript, from);
}

function ui(state: ScriptState): UiSnapshot {
  return toUiSnapshot(buildStateSnapshot(state), { mode: state.mode, simulatedFriend: state.simulatedFriend });
}

const sixMessages: ScriptAction[] = Array.from({ length: 6 }, () => ({ type: "next_message" }) as const);
const toAwaitingHumans: ScriptAction[] = [{ type: "load_reel" }, ...sixMessages];
const bothYes: ScriptAction[] = [
  ...toAwaitingHumans,
  { type: "decide", role: "a", choice: "accept" },
  { type: "decide", role: "b", choice: "accept" },
];

describe("the recorded run, stage by stage", () => {
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

describe("follow-through counts human events only", () => {
  it("never counts agent messages or the reel arriving, however many land", () => {
    const snapshot = ui(run(toAwaitingHumans));
    expect(snapshot.followThrough.agentMessageCount).toBe(6);
    expect(snapshot.followThrough.events).toHaveLength(0);
  });

  it("counts each human yes, the handoff, and showing up, but not policy changes", () => {
    const state = run([...bothYes, { type: "handoff" }, { type: "clock_next" }, { type: "clock_next" }]);
    expect(ui(state).followThrough.events.map((event) => event.label)).toEqual([
      "Aaron said yes",
      "Lisa said yes",
      "Aaron took the draft to WhatsApp",
      "Showed up (simulated clock)",
    ]);
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

  it("names the place in the proposal bubble", () => {
    const view = viewForRole(ui(run(toAwaitingHumans)), "a");
    const bubble = view.items.find((item) => item.kind === "bubble" && item.id === "proposal");
    expect(bubble).toMatchObject({ text: expect.stringContaining("Shawarma Point") });
  });

  it("shows one live card per human and collapses it after a yes", () => {
    expect(viewForRole(ui(run(toAwaitingHumans)), "a").status).toBe("⏳ waiting for you");
    const aYes = ui(run([...toAwaitingHumans, { type: "decide", role: "a", choice: "accept" }]));
    const view = viewForRole(aYes, "a");
    expect(view.items.some((item) => item.kind === "plan-card")).toBe(false);
    expect(view.items.some((item) => item.kind === "collapsed")).toBe(true);
    expect(view.status).toBe("⏳ waiting for Lisa");
    expect(viewForRole(aYes, "b").items.some((item) => item.kind === "plan-card")).toBe(true);
  });

  it("gives only the initiator the draft card; the friend is told it is coming", () => {
    const confirmed = ui(run(bothYes));
    expect(viewForRole(confirmed, "a").items.some((item) => item.kind === "draft-card")).toBe(true);
    expect(viewForRole(confirmed, "b").items.some((item) => item.kind === "draft-card")).toBe(false);
  });

  it("says the place was kept private when location is withheld", () => {
    const withheld = ui(run([{ type: "set_location", shared: false }, ...toAwaitingHumans]));
    expect(withheld.plan?.place).toBeNull();
    expect(withheld.messages[1]?.removed).toContain("location");
  });

  it("labels the simulated friend instead of Lisa's Muse", () => {
    const snapshot = ui(run([{ type: "set_simulated", value: true }, ...toAwaitingHumans]));
    expect(viewForRole(snapshot, "b").museName).toBe("Michelle's Muse");
    expect(viewForRole(snapshot, "a").friendMuseName).toBe("Michelle's Muse");
  });
});
