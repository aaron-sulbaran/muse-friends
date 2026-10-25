import { describe, expect, it } from "vitest";
import type { StateSnapshot } from "@/lib/protocol";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { namesFor } from "@/lib/ui/format";
import { toUiSnapshot, withoutUnknownAgents } from "@/lib/ui/snapshot";
import { timelineOf } from "@/lib/ui/timeline";

const live = { mode: "live" } as const;
const GHOST_CONTEXT = "ctx_ghost_thread";

/*
 * A store can hold rows from a build that knows more people than this one (a group plan's third friend left in
 * a shared room by a branch run). The id here is made up so the guard is tested against "an agent this build does
 * not know", whichever build that is.
 */
function withStranger(state: StateSnapshot): StateSnapshot {
  const pairThread = state.threads[0];
  const pairMessage = state.messages[0];
  const ghost = "ghost" as never;
  return {
    ...state,
    threads: [...state.threads, { ...pairThread, contextId: GHOST_CONTEXT, participants: ["aaron", ghost] }],
    messages: [
      ...state.messages,
      { ...pairMessage, message: { ...pairMessage.message, id: "msg_ghost_1", contextId: GHOST_CONTEXT, from: "aaron", to: ghost } },
      { ...pairMessage, message: { ...pairMessage.message, id: "msg_ghost_2", contextId: GHOST_CONTEXT, from: ghost, to: "aaron", seq: 2 } },
    ],
    events: [
      ...state.events,
      { id: "evt_ghost_thread", at: pairMessage.message.at, kind: "thread_opened", actor: "agent", contextId: GHOST_CONTEXT, text: "Sprout opened a thread with a stranger" },
      { id: "evt_ghost_agent", at: pairMessage.message.at, kind: "policy_changed", actor: "human", agent: ghost, text: "A stranger changed sharing" },
    ],
    redactions: [
      ...state.redactions,
      {
        id: "red_ghost",
        contextId: GHOST_CONTEXT,
        messageId: "msg_ghost_1",
        from: "aaron",
        to: ghost,
        removed: ["location"],
        detail: "withheld",
        at: pairMessage.message.at,
      },
    ],
  };
}

describe("rows that name an agent this build does not know", () => {
  it("never reach the UI snapshot", () => {
    const snapshot = toUiSnapshot(withStranger(snapshotAtPlanState("awaiting_humans")), live);
    const known = new Set(["aaron", "lisa"]);
    expect(snapshot.messages.length).toBeGreaterThan(0);
    for (const message of snapshot.messages) {
      expect(known.has(message.from)).toBe(true);
      expect(known.has(message.to)).toBe(true);
    }
    expect(snapshot.messages.some((message) => message.id.startsWith("msg_ghost"))).toBe(false);
  });

  it("leave Activity with a name and an avatar on every row, and no row about them", () => {
    const snapshot = toUiSnapshot(withStranger(snapshotAtPlanState("awaiting_humans")), live);
    const names = namesFor(snapshot);
    for (const entry of timelineOf(snapshot)) {
      expect(entry.kind === "message" ? names.muse[entry.message.from] : "ok").toBeTruthy();
      expect(entry.kind === "message" ? names.muse[entry.message.to] : "ok").toBeTruthy();
    }
    expect(snapshot.notes.some((note) => note.text.includes("stranger"))).toBe(false);
    expect(JSON.stringify(snapshot)).not.toContain("ghost");
  });

  it("are not a model call in flight", () => {
    const state = withStranger(snapshotAtPlanState("negotiating"));
    const ghostThread = state.threads.find((thread) => thread.contextId === GHOST_CONTEXT)!;
    ghostThread.state = "working";
    expect(toUiSnapshot(state, live).inFlight?.agent).not.toBe("ghost");
  });

  it("leave a store with only known agents exactly as it was", () => {
    const state = snapshotAtPlanState("awaiting_humans");
    expect(withoutUnknownAgents(state)).toBe(state);
  });

  it("drop the thread, its messages, its events and its redactions together", () => {
    const cleaned = withoutUnknownAgents(withStranger(snapshotAtPlanState("awaiting_humans")));
    expect(cleaned.threads.some((thread) => thread.contextId === GHOST_CONTEXT)).toBe(false);
    expect(cleaned.messages.some((record) => record.message.contextId === GHOST_CONTEXT)).toBe(false);
    expect(cleaned.events.some((event) => event.id.startsWith("evt_ghost"))).toBe(false);
    expect(cleaned.redactions.some((redaction) => redaction.id === "red_ghost")).toBe(false);
    expect(cleaned.messages.length).toBe(snapshotAtPlanState("awaiting_humans").messages.length);
  });
});
