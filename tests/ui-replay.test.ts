import { describe, expect, it } from "vitest";
import { PLAN_STATES, type RecordedRun } from "@/lib/protocol";
import { recordedSnapshot, shawarmaRun } from "@/lib/seed/fixtures";
import { buildReplay, beatTimes, holdFor, pickRun, progressOf, stateAt } from "@/lib/ui/replay";
import { scriptedRun } from "@/lib/ui/replay-source";

const run = scriptedRun();
const final = run.snapshot;
const ms = (iso: string) => Date.parse(iso);

describe("stateAt", () => {
  it("before anything happened there is no plan, no thread, no messages, no cards", () => {
    const empty = stateAt(final, beatTimes(final)[0] - 1);
    expect(empty).toMatchObject({ plans: [], threads: [], messages: [], cards: [] });
  });

  it("mid-negotiation the thread is working and counts only the messages shown", () => {
    const third = ms(final.messages[2].message.at);
    const state = stateAt(final, third);
    expect(state.messages).toHaveLength(3);
    expect(state.threads[0]).toMatchObject({ state: "working", messageCount: 3 });
    expect(state.plans[0].state).toBe("negotiating");
    expect(state.cards).toEqual([]);
  });

  it("once both agents accepted, both humans have a pending card and the thread waits on them", () => {
    const sixth = ms(final.messages[5].message.at);
    const state = stateAt(final, sixth + 2000);
    expect(state.plans[0]).toMatchObject({ state: "awaiting_humans", decisions: { aaron: "pending", lisa: "pending" } });
    expect(state.cards.map((card) => card.status)).toEqual(["pending", "pending"]);
    expect(state.threads[0].state).toBe("input-required");
  });

  it("one person's yes shows on their card and the plan keeps waiting for the other", () => {
    const aaronYes = final.events.find((event) => event.kind === "human_decision" && event.agent === "aaron")!;
    const state = stateAt(final, ms(aaronYes.at));
    expect(state.plans[0].decisions).toEqual({ aaron: "accepted", lisa: "pending" });
    expect(state.plans[0].state).toBe("awaiting_humans");
    expect(state.cards.find((card) => card.forAgent === "aaron")?.status).toBe("accepted");
  });

  it("the end of the run is the final plan state", () => {
    const last = beatTimes(final).at(-1)!;
    expect(stateAt(final, last).plans[0].state).toBe("followed_up");
  });
});

describe("buildReplay", () => {
  const replay = buildReplay(run);

  it("opens on the dead reel with the counter at 0 and ends with it at 1", () => {
    expect(replay.frames[0].snapshot.plan).toBeNull();
    expect(replay.frames[0].snapshot.followThrough.events).toHaveLength(0);
    expect(replay.frames.at(-1)!.snapshot.followThrough.events).toHaveLength(1);
    expect(replay.frames.at(-1)!.snapshot.plan?.state).toBe("followed_up");
  });

  it("never says Live over a recording", () => {
    expect(replay.frames.every((frame) => frame.snapshot.mode === "replay")).toBe(true);
    expect(replay.source).toBe("scripted");
  });

  it("only moves forward: the plan never goes back a step between frames", () => {
    const progress = replay.frames.map((frame) => {
      const state = frame.snapshot.plan?.state;
      return state === undefined ? -1 : PLAN_STATES.indexOf(state);
    });
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it("merges frames that look the same and keeps every hold readable", () => {
    expect(replay.frames.length).toBeGreaterThan(8);
    for (const frame of replay.frames.slice(0, -1)) expect(frame.holdMs).toBeGreaterThanOrEqual(900);
    expect(replay.frames.at(-1)!.holdMs).toBe(0);
    const keys = replay.frames.map((frame) => JSON.stringify({ ...frame.snapshot, now: undefined }));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses only the Muse names, never the internal ids", () => {
    expect(JSON.stringify(replay.frames.map((frame) => frame.snapshot.sides))).not.toMatch(/Aaron|Lisa/);
  });
});

describe("holdFor", () => {
  it("shortens the recorded gap, keeps it between a beat and a breath, and gives a clock jump a flat beat", () => {
    expect(holdFor(100)).toBe(900);
    expect(holdFor(2000)).toBe(1200);
    expect(holdFor(60_000)).toBe(2600);
    expect(holdFor(86_400_000)).toBe(1800);
  });
});

describe("pickRun", () => {
  const live = (id: string, recordedAt: string, snapshot = final): RecordedRun => ({ ...run, id, source: "live", recordedAt, snapshot });

  it("prefers the run that got furthest, then a live run, then the newest", () => {
    const short = { ...shawarmaRun(), id: "short" };
    expect(progressOf(short.snapshot)).toBeLessThan(progressOf(final));
    expect(pickRun([short, run])?.id).toBe(run.id);
    expect(pickRun([run, live("live-old", "2026-10-24T20:00:00-05:00")])?.id).toBe("live-old");
    expect(pickRun([live("a", "2026-10-24T20:00:00-05:00"), live("b", "2026-10-24T21:00:00-05:00")])?.id).toBe("b");
  });

  it("returns null when nothing saved has a plan", () => {
    const empty: RecordedRun = { ...run, id: "empty", snapshot: { ...recordedSnapshot(), plans: [] } };
    expect(pickRun([empty])).toBeNull();
    expect(pickRun([])).toBeNull();
  });
});
