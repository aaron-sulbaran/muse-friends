import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Checks, formatTable, median, summarize, writeReport } from "./evals/harness";
import { leakedPrivateStrings, policyViolations, windowViolations, windowsDroppedTotal } from "./evals/invariants";
import type { AgentMessage, MessageRecord, SharePolicy } from "@/lib/protocol";
import { PRIVATE_STRINGS } from "@/lib/seed/fixtures";

// The evals' own bookkeeping and invariants, tested without a model: an invariant that cannot fail is not an eval.

const base: AgentMessage = {
  id: "msg_1",
  contextId: "ctx_1",
  seq: 1,
  from: "aaron",
  to: "lisa",
  type: "intent",
  state: "working",
  reason: "interest_match",
  activity: { kind: "food", title: "Shawarma Point", place: "E 6th St" },
  windows: [{ start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" }],
  at: "2026-10-25T14:00:00-05:00",
};
const record = (message: Partial<AgentMessage> = {}, windowsDropped = 0): MessageRecord => ({
  message: { ...base, ...message } as AgentMessage,
  stamp: { passed: [], removed: [], windowsDropped },
  delivery: "delivered",
});
const policy = (categories: SharePolicy["categories"] = {}, tier: SharePolicy["tier"] = "close"): SharePolicy => ({ owner: "aaron", friend: "lisa", tier, categories });
const free = { start: "2026-10-27T17:00:00-05:00", end: "2026-10-27T22:00:00-05:00" };

describe("the results", () => {
  it("takes medians of odd and even counts and of nothing", () => {
    expect([median([3, 1, 2]), median([1, 2, 3, 10]), median([])]).toEqual([2, 3, 0]);
  });

  it("collects every miss in a run instead of stopping at the first", () => {
    const checks = new Checks();
    checks.that(true, "fine");
    checks.that(false, "first miss");
    checks.that(false, "second miss");
    checks.note("amount", 12);
    expect(checks.result(1500, 3)).toEqual({ pass: false, failures: ["first miss", "second miss"], ms: 1500, messages: 3, detail: { amount: 12 } });
    expect(new Checks().result(1, null).pass).toBe(true);
  });

  it("summarizes runs and prints one table with the failures under it", () => {
    const pass = new Checks();
    const fail = new Checks();
    fail.that(false, "the plan ended dropped");
    const summary = summarize({ id: "1", name: "plan", invariants: "x" }, [pass.result(10_000, 3), fail.result(20_000, 5), pass.result(30_000, 4)]);
    expect(summary).toMatchObject({ runs: 3, passes: 2, medianMs: 20_000, medianMessages: 4, failures: ["run 2: the plan ended dropped"] });
    const table = formatTable([summary, summarize({ id: "4", name: "payments", invariants: "y" }, [pass.result(5_000, null)])]);
    expect(table).toContain("1  plan      3     2/3     20.0s        4");
    expect(table).toContain("4  payments  1     1/1     5.0s         -");
    expect(table).toContain("1 plan: 2/3 passed\n  - run 2: the plan ended dropped");
  });

  it("writes the report and a latest copy", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "evals-"));
    const summaries = [summarize({ id: "1", name: "plan", invariants: "x" }, [new Checks().result(1000, 3)])];
    const { file, latest } = writeReport({ startedAt: "2026-10-25T08:00:00.000Z", runsPerScenario: 1, model: "m", scenarios: summaries }, directory);
    expect(path.basename(file)).toBe("report-2026-10-25T08-00-00-000Z.json");
    expect(JSON.parse(readFileSync(latest, "utf8"))).toMatchObject({ runsPerScenario: 1, scenarios: [{ id: "1", passes: 1 }] });
  });
});

describe("the invariants can fail", () => {
  it("finds a category the policy has off, and a policy scan that still had something to remove", () => {
    expect(policyViolations([record()], [policy()])).toEqual([]);
    const off = policyViolations([record()], [policy({ location: false })]);
    expect(off.join(" ")).toMatch(/carries location but aaron's policy for lisa has it off/);
    expect(off.join(" ")).toMatch(/still had location for the policy scan to remove/);
    expect(policyViolations([record()], [])).not.toEqual([]);
  });

  it("finds a window outside the free blocks or longer than three hours, and counts dropped windows", () => {
    const blocks = { aaron: [free], lisa: [free] };
    expect(windowViolations([record()], blocks)).toEqual([]);
    const outside = record({ windows: [{ start: "2026-10-27T10:00:00-05:00", end: "2026-10-27T11:00:00-05:00" }] });
    expect(windowViolations([outside], blocks).join(" ")).toMatch(/outside aaron's free blocks/);
    const long = record({ windows: [{ start: "2026-10-27T17:00:00-05:00", end: "2026-10-27T21:00:00-05:00" }] });
    expect(windowViolations([long], blocks).join(" ")).toMatch(/longer than 3 hours/);
    expect(windowsDroppedTotal([record({}, 2), record({}, 1)])).toBe(3);
  });

  it("finds a private string that crossed the wire", () => {
    const [secret] = Object.values(PRIVATE_STRINGS).flat();
    expect(leakedPrivateStrings([record()])).toEqual([]);
    expect(leakedPrivateStrings([record({ note: `see you after ${secret}` })])).toEqual([secret]);
  });
});
