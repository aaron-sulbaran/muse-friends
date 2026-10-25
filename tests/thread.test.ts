import { describe, expect, it } from "vitest";
import { closesThread, isForcedClose, nextThreadState, passedOver } from "@/lib/agent/thread";
import type { AgentMessage } from "@/lib/protocol";

const a = { start: "2026-10-26T21:00:00-05:00", end: "2026-10-26T22:00:00-05:00" };
const b = { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" };
const c = { start: "2026-10-28T18:00:00-05:00", end: "2026-10-28T19:30:00-05:00" };

const accept = (from: "aaron" | "lisa", window = b) => ({ from, type: "accept" as const, windows: [window] });
const prior = (...messages: Array<{ from: "aaron" | "lisa"; type: AgentMessage["type"]; windows?: AgentMessage["windows"] }>) => messages as unknown as AgentMessage[];

describe("nextThreadState", () => {
  it("stays working through the negotiation", () => {
    expect(nextThreadState({ from: "aaron", type: "intent" }, [])).toBe("working");
    expect(nextThreadState({ from: "lisa", type: "propose", windows: [a, b, c] }, [])).toBe("working");
    expect(nextThreadState(accept("aaron"), prior({ from: "lisa", type: "counter", windows: [b] }))).toBe("working");
  });

  it("needs input once both agents accepted the same window", () => {
    expect(nextThreadState(accept("lisa"), prior(accept("aaron")))).toBe("input-required");
  });

  it("does not treat accepts of different windows as agreement", () => {
    expect(nextThreadState(accept("lisa", c), prior(accept("aaron", b)))).toBe("working");
  });

  it("does not count the same agent accepting twice", () => {
    expect(nextThreadState(accept("aaron"), prior(accept("aaron")))).toBe("working");
  });

  it("ends rejected on a decline", () => {
    expect(nextThreadState({ from: "lisa", type: "decline" }, [])).toBe("rejected");
  });
});

describe("thread rules", () => {
  it("forces a close on the sixth message", () => {
    expect([1, 5, 6].map(isForcedClose)).toEqual([false, false, true]);
    expect(closesThread("accept")).toBe(true);
    expect(closesThread("decline")).toBe(true);
    expect(closesThread("counter")).toBe(false);
  });

  it("finds the windows a reply passed over", () => {
    expect(passedOver([a, b, c], [b])).toEqual([a, c]);
    expect(passedOver([a, b], [{ start: "2026-10-27T18:30:00-05:00", end: "2026-10-27T19:30:00-05:00" }])).toEqual([a]);
    expect(passedOver([a, b], undefined)).toEqual([a, b]);
    expect(passedOver(undefined, [a])).toEqual([]);
  });
});
