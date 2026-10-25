import { describe, expect, it } from "vitest";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import { oneLine, toolCallsOf } from "@/lib/ui/tools";

const live = { mode: "live" } as const;

/** A fixture shaped the way Lane A will record it: name, one-line args, one-line result. */
const recorded = [
  { name: "get_my_calendar", args: { days: 7 }, result: "5 free blocks this week" },
  { name: "send_to_friend_agent", args: "intent, Shawarma Point, Tue 6 to 8pm", result: "sent as message 1" },
];

describe("tool calls on a message's proof", () => {
  it("become a name, a one-line summary of the arguments and one of the result", () => {
    expect(toolCallsOf({ toolCalls: recorded })).toEqual([
      { name: "get_my_calendar", args: '{"days":7}', result: "5 free blocks this week" },
      { name: "send_to_friend_agent", args: "intent, Shawarma Point, Tue 6 to 8pm", result: "sent as message 1" },
    ]);
  });

  it("show nothing when the proof has no tool calls, an empty list, or nonsense", () => {
    expect(toolCallsOf(undefined)).toBeUndefined();
    expect(toolCallsOf({})).toBeUndefined();
    expect(toolCallsOf({ toolCalls: [] })).toBeUndefined();
    expect(toolCallsOf({ toolCalls: "get_my_calendar" })).toBeUndefined();
    expect(toolCallsOf({ toolCalls: [null, 7, { args: "no name" }, { name: "  " }] })).toBeUndefined();
  });

  it("drop the entries that are not tool calls and keep the ones that are", () => {
    expect(toolCallsOf({ toolCalls: [null, { name: "surface_to_human", args: "plan", result: "card written" }] })).toEqual([
      { name: "surface_to_human", args: "plan", result: "card written" },
    ]);
  });

  it("are kept to one readable line", () => {
    expect(oneLine("a\n  b\t c")).toBe("a b c");
    expect(oneLine({ a: 1 })).toBe('{"a":1}');
    expect(oneLine(undefined)).toBe("");
    const long = oneLine("x".repeat(500));
    expect(long.length).toBeLessThanOrEqual(140);
    expect(long.endsWith("...")).toBe(true);
  });
});

describe("on the snapshot the drawer reads", () => {
  function withProof(extra: object | null) {
    const state = snapshotAtPlanState("awaiting_humans");
    const record = state.messages[0];
    record.proof = { model: "muse-spark-1.3", responseId: "resp_1", latencyMs: 1200, inputTokens: 10, outputTokens: 5, reasoningTokens: 2, ...(extra ?? {}) } as never;
    return toUiSnapshot(state, live).messages[0];
  }

  it("carries the tool calls when the store recorded them", () => {
    expect(withProof({ toolCalls: recorded }).proof?.toolCalls).toHaveLength(2);
  });

  it("carries no toolCalls key at all when it did not", () => {
    const proof = withProof(null).proof!;
    expect("toolCalls" in proof).toBe(false);
    expect(proof.responseId).toBe("resp_1");
  });

  it("leaves a scripted message with no proof at all", () => {
    const state = snapshotAtPlanState("awaiting_humans");
    delete state.messages[0].proof;
    expect(toUiSnapshot(state, live).messages[0].proof).toBeUndefined();
  });
});
