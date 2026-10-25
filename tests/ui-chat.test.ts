import { describe, expect, it } from "vitest";
import { PLAN_STATES, type PlanState, type StateSnapshot } from "@/lib/protocol";
import { recordedSnapshot, seedSnapshot } from "@/lib/seed/fixtures";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { viewForRole, type ChatItem } from "@/lib/ui/chat";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import type { Role } from "@/lib/ui/types";

const live = { mode: "live" } as const;

function at(state: PlanState) {
  return toUiSnapshot(snapshotAtPlanState(state), live);
}

function kinds(items: ChatItem[]) {
  return items.map((item) => item.kind);
}

describe("every plan state renders on both phones", () => {
  for (const state of PLAN_STATES) {
    it(`${state}: no internal ids, a status or none, and no agent chatter`, () => {
      for (const role of ["a", "b"] as Role[]) {
        const view = viewForRole(at(state), role);
        const text = JSON.stringify(view);
        expect(text).not.toMatch(/Aaron|Lisa/);
        expect(text).not.toContain('"intent"');
        expect(view.items.length).toBeGreaterThan(0);
      }
    });
  }
});

describe("how a judge starts", () => {
  const empty = () => toUiSnapshot(seedSnapshot(), live);

  it("side b can send the reel, and side a can bring in the simulated friend", () => {
    expect(viewForRole(empty(), "b").items.find((item) => item.kind === "start-card")).toMatchObject({ variant: "send-reel", friendName: "Sprout" });
    expect(viewForRole(empty(), "a").items.find((item) => item.kind === "start-card")).toMatchObject({ variant: "simulated-friend" });
  });

  it("with a simulated friend, side b has nothing to tap: she sends the reel herself", () => {
    const state = seedSnapshot();
    state.room = { ...state.room, simulatedFriend: true };
    const snapshot = toUiSnapshot(state, live);
    expect(kinds(viewForRole(snapshot, "b").items)).not.toContain("start-card");
    expect(viewForRole(snapshot, "b").museName).toBe("Michelle's Muse");
  });

  it("once a plan exists, nobody is offered a start", () => {
    for (const role of ["a", "b"] as Role[]) expect(kinds(viewForRole(at("detected"), role).items)).not.toContain("start-card");
  });
});

describe("the journey, phone by phone", () => {
  it("reading the reel, then talking, are status lines and nothing else in the chat", () => {
    expect(viewForRole(at("detected"), "a").status).toBe("🎞️ reading Mochi's reel");
    expect(viewForRole(at("negotiating"), "a").status).toBe("💬 talking to Mochi");
    expect(viewForRole(at("negotiating"), "b").status).toBe("💬 talking to Sprout");
    expect(kinds(viewForRole(at("negotiating"), "a").items)).not.toContain("plan-card");
  });

  it("both agents agreed: one proposal bubble and one live card on each phone", () => {
    for (const role of ["a", "b"] as Role[]) {
      const view = viewForRole(at("awaiting_humans"), role);
      expect(view.items.filter((item) => item.kind === "plan-card")).toHaveLength(1);
      expect(view.status).toBe("⏳ waiting for you");
    }
    const bubble = viewForRole(at("awaiting_humans"), "a").items.find((item) => item.kind === "bubble" && item.id === "proposal");
    expect(bubble).toMatchObject({ text: "You and Mochi both want to try Shawarma Point, and you're both free Tuesday 6 to 8." });
  });

  it("collapses a card to a line after that person's yes, and waits for the other", () => {
    const state = snapshotAtPlanState("awaiting_humans");
    state.plans[0].decisions.aaron = "accepted";
    const snapshot = toUiSnapshot(state, live);
    const a = viewForRole(snapshot, "a");
    expect(kinds(a.items)).toContain("collapsed");
    expect(kinds(a.items)).not.toContain("plan-card");
    expect(a.status).toBe("⏳ waiting for Mochi");
    expect(kinds(viewForRole(snapshot, "b").items)).toContain("plan-card");
  });

  it("gives only the initiator the draft card; the friend is told it is coming", () => {
    const confirmed = at("confirmed");
    expect(kinds(viewForRole(confirmed, "a").items)).toContain("draft-card");
    expect(kinds(viewForRole(confirmed, "b").items)).not.toContain("draft-card");
  });

  it("scheduled adds the hold row to both phones", () => {
    for (const role of ["a", "b"] as Role[]) expect(kinds(viewForRole(at("scheduled"), role).items)).toContain("hold-row");
  });

  it("reminded and followed up add a day separator and the Muse's line", () => {
    const reminded = viewForRole(at("reminded"), "a").items;
    expect(reminded.some((item) => item.kind === "bubble" && item.text.startsWith("Shawarma Point with Mochi at 6"))).toBe(true);
    const followed = viewForRole(at("followed_up"), "a").items;
    expect(followed.some((item) => item.kind === "bubble" && item.text.includes("next month"))).toBe(true);
  });

  it("a friend's no reads neutrally on each side", () => {
    const a = viewForRole(at("dropped"), "a").items.find((item) => item.kind === "bubble" && item.id === "dropped");
    const b = viewForRole(at("dropped"), "b").items.find((item) => item.kind === "bubble" && item.id === "dropped");
    expect(a).toMatchObject({ text: "Mochi said not now." });
    expect(b).toMatchObject({ text: "You said not now" });
  });
});

describe("follow-through counts one thing: plans that happened", () => {
  it("reads 0 on the dead reel and every state before the plan took place", () => {
    for (const state of ["detected", "negotiating", "awaiting_humans", "confirmed", "scheduled", "reminded"] as PlanState[]) {
      expect(at(state).followThrough.events).toHaveLength(0);
    }
  });

  it("reads 1 once it happened, and stays 1 after the follow-up", () => {
    for (const state of ["happened", "followed_up"] as PlanState[]) {
      expect(at(state).followThrough.events.map((event) => event.label)).toEqual(["Sprout and Mochi got shawarma together"]);
    }
  });

  it("lists taps and sends separately and never counts agent messages", () => {
    const snapshot = at("confirmed");
    expect(snapshot.followThrough.humanTapCount).toBe(3);
    expect(snapshot.followThrough.agentMessageCount).toBe(6);
    expect(snapshot.followThrough.events).toHaveLength(0);
  });
});

describe("what the store can say that the recorded states do not", () => {
  it("withholds the place once a redaction removed location, even if the plan still names it", () => {
    const state: StateSnapshot = recordedSnapshot();
    expect(toUiSnapshot(state, live).plan?.place).toBe("E 6th St, Austin");
    state.redactions.push({
      id: "red_1",
      contextId: state.threads[0].contextId,
      messageId: state.messages[1].message.id,
      from: "lisa",
      to: "aaron",
      removed: ["location"],
      detail: "Location removed under the new setting.",
      at: state.clock.now,
    });
    expect(toUiSnapshot(state, live).plan?.place).toBeNull();
  });

  it("maps model proof onto the row", () => {
    const state = recordedSnapshot();
    state.messages[0].proof = { model: "muse-spark-1.3", responseId: "resp_1", latencyMs: 1234, inputTokens: 500, outputTokens: 140, reasoningTokens: 90 };
    expect(toUiSnapshot(state, live).messages[0].proof).toEqual(state.messages[0].proof);
    expect(toUiSnapshot(recordedSnapshot(), live).messages[0].proof).toBeUndefined();
  });

  it("a turn that produced no message shows the failure: status, row, and an honest bubble", () => {
    const state = recordedSnapshot();
    state.threads[0] = { ...state.threads[0], state: "failed", dropReason: "cap_reached" };
    state.plans[0] = { ...state.plans[0], state: "dropped", dropReason: "cap_reached" };
    state.events.push({ id: "evt_fail", at: state.clock.now, kind: "turn_failed", actor: "system", agent: "lisa", contextId: state.threads[0].contextId, text: "Mochi's turn ended without a message" });
    const snapshot = toUiSnapshot(state, live);
    expect(snapshot.failure).toEqual({ agent: "lisa" });
    expect(snapshot.plan?.droppedReason).toBe("A model call failed");
    const view = viewForRole(snapshot, "a");
    expect(view.status).toBe("⚠️ having trouble reaching Mochi");
    expect(view.items.find((item) => item.kind === "bubble" && item.id === "dropped")).toMatchObject({ text: "Mochi didn't answer, so this plan stopped." });
  });

  it("labels the simulated friend when the room says so", () => {
    const state = recordedSnapshot();
    state.room = { ...state.room, simulatedFriend: true };
    const snapshot = toUiSnapshot(state, live);
    expect(snapshot.simulatedFriend).toBe(true);
    expect(viewForRole(snapshot, "b").museName).toBe("Michelle's Muse");
    expect(viewForRole(snapshot, "a").friendHumanName).toBe("Michelle");
  });
});
