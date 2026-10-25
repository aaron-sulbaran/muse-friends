import { describe, expect, it } from "vitest";
import { StateSnapshot } from "@/lib/protocol";
import { privacyToggleDemo, recordedSnapshot, seedSnapshot } from "@/lib/seed/fixtures";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { toUiSnapshot } from "@/lib/ui/snapshot";

const live = { mode: "live" } as const;

describe("toUiSnapshot on Lane A's fixtures", () => {
  it("renders the seed as an empty stage with a quiet clock", () => {
    const snapshot = toUiSnapshot(seedSnapshot(), live);
    expect(snapshot.plan).toBeNull();
    expect(snapshot.messages).toEqual([]);
    expect(snapshot.inFlight).toBeNull();
    expect(snapshot.clockSimulated).toBe(false);
  });

  it("renders the recorded thread: six messages, awaiting both humans, nobody thinking", () => {
    const state = recordedSnapshot();
    expect(StateSnapshot.safeParse(state).success).toBe(true);
    const snapshot = toUiSnapshot(state, live);
    expect(snapshot.messages.map((message) => message.type)).toEqual(["intent", "propose", "counter", "counter", "accept", "accept"]);
    expect(snapshot.plan).toMatchObject({ state: "awaiting_humans", initiator: "aaron", decisions: { a: "pending", b: "pending" } });
    expect(snapshot.plan?.activityTitle).toBe("Shawarma Point");
    expect(snapshot.inFlight).toBeNull();
  });

  it("carries the raw wire message for the JSON drawer and the stamp for the row", () => {
    const [intent] = toUiSnapshot(recordedSnapshot(), live).messages;
    expect(intent.raw).toMatchObject({ id: "msg_shawarma_001", type: "intent", from: "aaron", to: "lisa" });
    expect(intent.shared).toContain("food");
    expect(intent.removed).toEqual([]);
  });

  it("shows the privacy beat: the replayed propose arrives with location removed", () => {
    const demo = privacyToggleDemo();
    const state = recordedSnapshot();
    state.messages[1] = demo.messageAfter;
    const withheld = toUiSnapshot(state, live).messages[1];
    expect(withheld.removed).toEqual(["location"]);
    expect(withheld.shared).not.toContain("location");
  });

  it("derives who is thinking from the thread: the receiver of the last message", () => {
    const state = recordedSnapshot();
    state.threads[0].state = "working";
    state.threads[0].messageCount = 5;
    state.messages = state.messages.slice(0, 5);
    // Message 5 is Aaron's accept, so Lisa's agent has the next turn.
    expect(toUiSnapshot(state, live).inFlight).toEqual({ agent: "lisa" });
  });

  it("counts only followed_through events: the reel arriving and taps are not the outcome", () => {
    const state = recordedSnapshot();
    expect(state.events.some((event) => event.kind === "signal_received" && event.actor === "human")).toBe(true);
    expect(toUiSnapshot(state, live).followThrough.events).toEqual([]);
    const happened = snapshotAtPlanState("happened");
    const counted = toUiSnapshot(happened, live).followThrough;
    expect(counted.events.map((event) => event.id)).toEqual(["evt_followed_through"]);
    expect(counted.humanTapCount).toBe(3);
  });

  it("names each side from the persona display names and reads the room's simulated flag", () => {
    const state = recordedSnapshot();
    expect(toUiSnapshot(state, live).sides).toEqual({ aaron: "Sprout", lisa: "Mochi" });
    expect(toUiSnapshot(state, live).simulatedFriend).toBe(false);
    state.room = { ...state.room, simulatedFriend: true };
    expect(toUiSnapshot(state, live).simulatedFriend).toBe(true);
  });

  it("reads Lisa's sharing policy toward Aaron through the policy helper", () => {
    const state = recordedSnapshot();
    expect(toUiSnapshot(state, live).sharing.lisa.categories.location).toBe(true);
    state.policies = state.policies.map((policy) =>
      policy.owner === "lisa" ? { ...policy, categories: { ...policy.categories, location: false } } : policy,
    );
    expect(toUiSnapshot(state, live).sharing.lisa.categories.location).toBe(false);
  });

  it("marks a rejected delivery as blocked, with the reason", () => {
    const state = recordedSnapshot();
    state.messages[2] = { ...state.messages[2], delivery: "rejected", httpStatus: 422, error: "window not in Sprout's calendar" };
    expect(toUiSnapshot(state, live).messages[2].blockedRule).toBe("window not in Sprout's calendar");
  });
});
