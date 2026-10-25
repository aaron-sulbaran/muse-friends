import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  checkHealth,
  checkReplay,
  demoResult,
  groupResult,
  parseArgs,
  paymentsConfirmResult,
  paymentsDeclineResult,
  privacyResult,
  roomIsEmpty,
  runGate,
} from "../scripts/gate-c5.mjs";

const goodFrame = (messages: number, holdMs = 400) => ({
  snapshot: { mode: "replay", messages: Array.from({ length: messages }, (_, index) => ({ seq: index + 1, from: "a" })) },
  holdMs,
});
const goodReplay = () => ({
  data: { id: "run_x", label: "Scripted run", source: "scripted", frames: [goodFrame(0), goodFrame(2), goodFrame(6)] },
  error: null,
});

describe("parseArgs", () => {
  it("defaults to the www address and two runs, and reads the options", () => {
    expect(parseArgs([])).toMatchObject({ base: "https://www.musefriends.tech", runs: 2, timeout: 120, force: false, expectSha: null });
    const options = parseArgs(["--", "--base", "http://localhost:3001/", "--runs", "1", "--force", "--expect-sha", "abc1234", "--verbose"]);
    expect(options).toMatchObject({ base: "http://localhost:3001", runs: 1, force: true, verbose: true, expectSha: "abc1234" });
  });

  it("falls back to sane numbers when they are not numbers", () => {
    expect(parseArgs(["--runs", "zero", "--timeout", "soon"])).toMatchObject({ runs: 2, timeout: 120 });
  });
});

describe("checkHealth", () => {
  it("passes with the commit, and only fails on a sha mismatch when one is expected", () => {
    expect(checkHealth(200, { ok: true, sha: "730202a" })).toEqual({ ok: true, detail: "commit 730202a" });
    expect(checkHealth(200, { ok: true, sha: "730202a" }, "730202a1234567890").ok).toBe(true);
    expect(checkHealth(200, { ok: true, sha: "730202a" }, "ffffffff").detail).toBe("deployed commit 730202a, expected fffffff");
  });

  it("fails on a bad status, a non-ok body, or a missing sha", () => {
    expect(checkHealth(503, null).ok).toBe(false);
    expect(checkHealth(200, { ok: false }).ok).toBe(false);
    expect(checkHealth(200, { ok: true }).detail).toBe("the health route exposes no commit sha");
  });
});

describe("checkReplay", () => {
  it("accepts a run whose frames parse and whose last frame carries messages 1 to N", () => {
    const result = checkReplay(goodReplay());
    expect(result.ok).toBe(true);
    expect(result.detail).toContain("3 frames, 6 messages");
  });

  it("rejects an error payload, too few frames, a live-mode frame, thin messages, and gaps", () => {
    expect(checkReplay({ data: null, error: { message: "boom" } }).ok).toBe(false);
    expect(checkReplay({ data: { ...goodReplay().data, frames: [goodFrame(6)] } }).detail).toContain("only 1 frame");
    expect(checkReplay({ data: { ...goodReplay().data, frames: [goodFrame(1), { snapshot: { mode: "live", messages: [] }, holdMs: 1 }] } }).detail).toContain("not a replay snapshot");
    expect(checkReplay({ data: { ...goodReplay().data, frames: [goodFrame(0), goodFrame(2)] } }).detail).toContain("expected at least 3");
    const gappy = goodFrame(3);
    gappy.snapshot.messages[1].seq = 5;
    expect(checkReplay({ data: { ...goodReplay().data, frames: [goodFrame(0), gappy] } }).detail).toContain("expected 1..3");
    expect(checkReplay({ data: { ...goodReplay().data, source: "dreamed" } }).ok).toBe(false);
  });
});

describe("reading demo:http's output", () => {
  const output = [
    "DEMO run 1/1 against http://x",
    "  PASS  plan reached awaiting_humans (awaiting_humans)",
    "  agents agreed in 3 messages at 11.2s",
    "  PASS  location redacted on 2 message(s): #2 Sprout, #3 Mochi",
  ].join("\n");

  it("takes the agreement time and the privacy line from it", () => {
    expect(demoResult(0, output)).toEqual({ ok: true, detail: "agreed in 3 messages at 11.2s" });
    expect(privacyResult(output)).toEqual({ ok: true, detail: "location redacted on 2 message(s): #2 Sprout, #3 Mochi" });
  });

  it("reports the failed checks, the not-empty exit, and a missing privacy line", () => {
    expect(demoResult(1, "  FAIL  plan reached awaiting_humans (was none)\n  FAIL  agreed within 4 messages (0)").detail).toBe(
      "plan reached awaiting_humans (was none); agreed within 4 messages (0)",
    );
    expect(demoResult(2, "").detail).toBe("the room was not empty");
    expect(demoResult(124, "").detail).toBe("exit code 124");
    expect(privacyResult("  FAIL  location redacted on 0 message(s): none").ok).toBe(false);
    expect(privacyResult("nothing relevant").detail).toContain("never reached");
  });
});

describe("roomIsEmpty", () => {
  it("is true only with no plan, no messages, and no agent turn running", () => {
    expect(roomIsEmpty({ plan: null, messages: [] })).toBe(true);
    expect(roomIsEmpty({ plan: null, messages: [], inFlight: { agent: "aaron" } })).toBe(false);
    expect(roomIsEmpty({ plan: { state: "awaiting_humans" }, messages: [] })).toBe(false);
    expect(roomIsEmpty({ plan: null, messages: [{}] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The whole gate against a fake app and fake demo:http scripts
// ---------------------------------------------------------------------------

type Room = { plan: unknown; messages: unknown[]; simulatedFriend: boolean; inFlight?: unknown };

// These tests run the real gate against a fake app and spawn a real node process for each demo run, so what they cost
// depends on the machine: a few hundred milliseconds when it is idle, seconds when the whole suite (or another suite)
// is running beside it. Vitest's 5 second default timed them out under load, so they get a limit nothing real comes
// near, and nothing in them is asserted on wall-clock time.
describe("runGate end to end", { timeout: 60_000 }, () => {
  let server: Server;
  let base: string;
  let room: Room;
  let health: { status: number; body: unknown };
  let replay: unknown;
  let controls: Array<Record<string, unknown>>;
  let demoRuns: number;
  let dir: string;
  // The running agent turn "finishes" on the Nth read of /api/state, counted by the fake app, instead of after a
  // wall-clock delay, so the test does not depend on how fast the gate gets to its first read.
  let stateReads: number;
  let finishTurnAfterReads: number | null;
  // What the fake app answers to the GET the gate uses to see whether a feature's route exists (405 there, 404 absent),
  // and which opt-in scripts the gate ran, with their arguments.
  let paymentsRoute: number;
  let groupRoute: number;
  let scriptRuns: Array<{ name: string; decline: boolean }>;

  const readBody = (request: IncomingMessage) =>
    new Promise<string>((resolve) => {
      let text = "";
      request.on("data", (chunk) => (text += chunk));
      request.on("end", () => resolve(text));
    });

  beforeEach(async () => {
    room = { plan: null, messages: [], simulatedFriend: false };
    health = { status: 200, body: { ok: true, sha: "730202a" } };
    replay = goodReplay();
    controls = [];
    demoRuns = 0;
    stateReads = 0;
    finishTurnAfterReads = null;
    paymentsRoute = 405;
    groupRoute = 405;
    scriptRuns = [];
    dir = mkdtempSync(path.join(tmpdir(), "muse-gate-"));
    server = createServer(async (request, response) => {
      const send = (status: number, body: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (request.method === "GET" && request.url === "/api/health") return send(health.status, health.body);
      if (request.method === "GET" && request.url === "/api/state") {
        stateReads += 1;
        if (finishTurnAfterReads !== null && stateReads >= finishTurnAfterReads) room.inFlight = undefined;
        return send(200, room);
      }
      if (request.method === "GET" && request.url === "/api/replay") return send(200, replay);
      if (request.method === "POST" && request.url === "/api/controls") {
        const body = JSON.parse((await readBody(request)) || "{}");
        controls.push(body);
        if (body.type === "reset") Object.assign(room, { plan: null, messages: [] });
        if (body.type === "simulated_friend") room.simulatedFriend = body.on;
        return send(200, { data: {}, error: null });
      }
      if (request.method === "GET" && request.url === "/api/plans/gate_probe/settle") return send(paymentsRoute, {});
      if (request.method === "GET" && request.url === "/api/simulated-member") return send(groupRoute, {});
      if (request.method === "POST" && request.url?.startsWith("/__script")) {
        const query = new URL(request.url, "http://x").searchParams;
        scriptRuns.push({ name: query.get("name") ?? "", decline: query.get("decline") === "1" });
        return send(200, {});
      }
      if (request.method === "POST" && request.url === "/__ran") {
        demoRuns += 1;
        return send(200, {});
      }
      if (request.method === "POST" && request.url === "/__dirty") {
        Object.assign(room, { plan: { state: "awaiting_humans" }, messages: [{ seq: 1 }] });
        return send(200, {});
      }
      return send(404, { error: "no such route" });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  // A stand-in for scripts/demo-http.mjs: reports the run to the fake server, optionally leaves the room
  // dirty, prints what the real script prints, and exits with the given code.
  function fakeDemo(options: { exit?: number; privacyLine?: string | null; dirty?: boolean } = {}): string {
    const { exit = 0, privacyLine = "  PASS  location redacted on 2 message(s): #2 Sprout, #3 Mochi", dirty = false } = options;
    const file = path.join(dir, `demo-${Math.random().toString(36).slice(2)}.mjs`);
    writeFileSync(
      file,
      `const base = process.argv[process.argv.indexOf("--base") + 1];
await fetch(base + "/__ran", { method: "POST" });
${dirty ? 'await fetch(base + "/__dirty", { method: "POST" });' : ""}
console.log(${JSON.stringify(exit === 0 ? "  PASS  plan reached awaiting_humans (awaiting_humans)" : "  FAIL  plan reached awaiting_humans (was none)")});
console.log("  agents agreed in 3 messages at 11.2s");
${privacyLine === null ? "" : `console.log(${JSON.stringify(privacyLine)});`}
process.exit(${exit});
`,
    );
    return file;
  }

  // Stand-ins for scripts/demo-payments.mjs and scripts/demo-group.mjs: they report the run to the fake app, then print
  // what the real scripts print. The confirm run and the --decline run of the payments script are told apart by argument.
  function fakeScript(name: string, outputs: { confirm: string; decline?: string }, exit = 0): string {
    const file = path.join(dir, `${name}-${Math.random().toString(36).slice(2)}.mjs`);
    writeFileSync(
      file,
      `const base = process.argv[process.argv.indexOf("--base") + 1];
const decline = process.argv.includes("--decline");
await fetch(base + "/__script?name=${name}&decline=" + (decline ? "1" : "0"), { method: "POST" });
const outputs = ${JSON.stringify(outputs)};
console.log(decline && outputs.decline !== undefined ? outputs.decline : outputs.confirm);
process.exit(${exit});
`,
    );
    return file;
  }

  function fakePayments(overrides: { moved?: string; ids?: string; declineLine?: string; exit?: number } = {}): string {
    const moved = overrides.moved ?? "  PASS  balances moved by $9: payer 120 to 111, friend 80 to 89";
    const ids = overrides.ids ?? "  payment ids: withdrawal wd_1, deposit dp_1";
    const declineLine = overrides.declineLine ?? "  PASS  a decline moved nothing";
    const confirm = ["  PASS  the payer's Muse prepared a payment", "  PASS  confirm accepted (200)", moved, ids, "ALL CHECKS PASSED"].join("\n");
    const decline = ["  PASS  the payer's Muse prepared a payment", "  PASS  decline accepted (200)", declineLine, "ALL CHECKS PASSED"].join("\n");
    return fakeScript("payments", { confirm, decline }, overrides.exit ?? 0);
  }

  function fakeGroup(overrides: { confirmed?: string | null; members?: string; note?: string; exit?: number } = {}): string {
    const lines = [
      "  PASS  the three Muses reached awaiting_humans in 21.0s (was awaiting_humans)",
      overrides.confirmed === undefined ? "  PASS  plan confirmed by all three (confirmed)" : overrides.confirmed,
      overrides.members ?? "  PASS  every member accepted (aaron:accepted lisa:accepted kai:accepted)",
      overrides.note ?? "  total 41.2s from the reel to a confirmed plan of three",
    ].filter((line): line is string => typeof line === "string");
    return fakeScript("group", { confirm: lines.join("\n") }, overrides.exit ?? 0);
  }

  async function gate(args: string[], demoScript: string, extra: Record<string, unknown> = {}) {
    const lines: string[] = [];
    const code = await runGate({ ...parseArgs(["--base", base, ...args]), demoScript, ...extra }, (line: string) => lines.push(line));
    return { code, lines, text: lines.join("\n") };
  }

  it("passes when every step passes, runs the scenario twice, and leaves the room reset", async () => {
    const { code, lines, text } = await gate([], fakeDemo());
    expect(code).toBe(0);
    expect(demoRuns).toBe(2);
    expect(lines.filter((line) => line.startsWith("FAIL"))).toEqual([]);
    for (const expected of [
      "PASS  health answers ok with the deployed commit (commit 730202a",
      "PASS  the demo room is free (empty)",
      "PASS  simulated friend is off",
      "PASS  demo:http run 1 of 2 (agreed in 3 messages at 11.2s",
      "PASS  demo:http run 2 of 2",
      "PASS  privacy toggle, run 1 (location redacted on 2 message(s)",
      "PASS  privacy toggle, run 2",
      'PASS  Replay parses and carries its messages (scripted run "Scripted run", 3 frames, 6 messages',
      "PASS  demo room left reset (empty, simulated friend off)",
      "C5 GATE: PASS (9 steps)",
    ]) {
      expect(text).toContain(expected);
    }
  });

  it("refuses a room that is not empty without --force, touches nothing, and exits 2", async () => {
    Object.assign(room, { plan: { state: "awaiting_humans" }, messages: [{ seq: 1 }] });
    const { code, text } = await gate([], fakeDemo());
    expect(code).toBe(2);
    expect(text).toContain("FAIL  the demo room is free: it holds plan awaiting_humans, 1 messages and would be cleared");
    expect(controls).toEqual([]);
    expect(demoRuns).toBe(0);
  });

  it("refuses a room where an agent turn is running even before it has written a plan", async () => {
    room.inFlight = { agent: "aaron" };
    const { code, text } = await gate([], fakeDemo());
    expect(code).toBe(2);
    expect(text).toContain("it holds plan none, 0 messages, an agent turn is running");
    expect(controls).toEqual([]);
    expect(demoRuns).toBe(0);
  });

  it("with --force waits for the running turn to finish before it starts, and fails if it never does", async () => {
    room.inFlight = { agent: "aaron" };
    finishTurnAfterReads = 3;
    const waited = await gate(["--force", "--runs", "1"], fakeDemo());
    expect(waited.code).toBe(0);
    expect(waited.text).toContain("PASS  no agent turn is running (it finished");
    // It saw the turn running (the room check and the first idle check), then waited and saw it finish.
    expect(stateReads).toBeGreaterThanOrEqual(3);
    finishTurnAfterReads = null;

    room.inFlight = { agent: "lisa" };
    const lines: string[] = [];
    const code = await runGate(
      { ...parseArgs(["--base", base, "--force", "--runs", "1"]), demoScript: fakeDemo(), idleWaitMs: 600 },
      (line: string) => lines.push(line),
    );
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("FAIL  no agent turn is running: one is still running after 0.6s");
    expect(demoRuns).toBe(1);
  });

  it("clears a busy room when --force is given", async () => {
    Object.assign(room, { plan: { state: "awaiting_humans" }, messages: [{ seq: 1 }] });
    const { code, text } = await gate(["--force", "--runs", "1"], fakeDemo());
    expect(code).toBe(0);
    expect(text).toContain("PASS  the demo room is free (plan awaiting_humans, 1 messages, --force given)");
    expect(demoRuns).toBe(1);
    expect(roomIsEmpty(room)).toBe(true);
  });

  it("turns the simulated friend off before the scenario, because demo:http taps both people", async () => {
    room.simulatedFriend = true;
    const { code, text } = await gate(["--runs", "1"], fakeDemo());
    expect(code).toBe(0);
    expect(controls[0]).toEqual({ type: "simulated_friend", on: false });
    expect(text).toContain("PASS  simulated friend turned off (it was on)");
    expect(room.simulatedFriend).toBe(false);
  });

  it("fails when a run fails, shows its output, and still leaves the room reset", async () => {
    const { code, text } = await gate(["--runs", "1"], fakeDemo({ exit: 1, dirty: true }));
    expect(code).toBe(1);
    expect(text).toContain("FAIL  demo:http run 1 of 1: plan reached awaiting_humans (was none)");
    expect(text).toContain("demo:http output");
    expect(text).toContain("PASS  demo room left reset (empty, simulated friend off)");
    expect(text).toContain("C5 GATE: FAIL (1 of 7 steps failed)");
    expect(roomIsEmpty(room)).toBe(true);
    expect(controls.some((body) => body.type === "reset")).toBe(true);
  });

  it("fails the privacy step when demo:http never printed its privacy check", async () => {
    const { code, text } = await gate(["--runs", "1"], fakeDemo({ privacyLine: null }));
    expect(code).toBe(1);
    expect(text).toContain("FAIL  privacy toggle, run 1: demo:http never reached the privacy toggle check");
  });

  it("fails when Replay is malformed, and only that step", async () => {
    replay = { data: { ...goodReplay().data, frames: [goodFrame(2)] }, error: null };
    const { code, lines } = await gate(["--runs", "1"], fakeDemo());
    expect(code).toBe(1);
    expect(lines.filter((line) => line.startsWith("FAIL"))).toEqual(["FAIL  Replay parses and carries its messages: only 1 frame(s)"]);
  });

  it("stops at the first step when the deployed commit is not the one expected", async () => {
    const { code, lines } = await gate(["--expect-sha", "deadbee"], fakeDemo());
    expect(code).toBe(1);
    expect(lines.filter((line) => line.startsWith("PASS") || line.startsWith("FAIL"))).toHaveLength(1);
    expect(lines.join("\n")).toContain("FAIL  health answers ok with the deployed commit: deployed commit 730202a, expected deadbee");
    expect(demoRuns).toBe(0);
    expect(controls).toEqual([]);
  });
  describe("the opt-in steps", () => {
    const fileMissing = path.join(tmpdir(), "muse-gate-no-such-script.mjs");

    it("add nothing without their flags: no payments or group line, no skip count, the same steps as before", async () => {
      const { code, text } = await gate([], fakeDemo(), { paymentsScript: fakePayments(), groupScript: fakeGroup() });
      expect(code).toBe(0);
      expect(text).not.toMatch(/payments|group of three|SKIP/);
      expect(text).toContain("C5 GATE: PASS (9 steps) against");
      expect(scriptRuns).toEqual([]);
    });

    it("--payments runs prepare then confirm, and prepare then decline, as one PASS line after Replay and before the reset", async () => {
      const { code, lines, text } = await gate(["--payments", "--runs", "1"], fakeDemo(), { paymentsScript: fakePayments(), groupScript: fileMissing });
      expect(code).toBe(0);
      expect(scriptRuns).toEqual([
        { name: "payments", decline: false },
        { name: "payments", decline: true },
      ]);
      const line = lines.find((entry) => entry.includes("payments, prepare then confirm and decline"))!;
      expect(line).toMatch(/^PASS {2}payments, prepare then confirm and decline \(confirm moved \$9 \(payer 120 to 111, friend 80 to 89; withdrawal wd_1, deposit dp_1\); decline moved nothing, /);
      const names = lines.map((entry) => entry.replace(/^(PASS|FAIL|SKIP) {2}/, ""));
      const at = (prefix: string) => names.findIndex((name) => name.startsWith(prefix));
      expect(at("payments, prepare")).toBeGreaterThan(at("Replay parses and carries"));
      expect(at("payments, prepare")).toBeLessThan(at("demo room left reset"));
      expect(text).toContain("C5 GATE: PASS (8 steps) against");
    });

    it("--payments fails when the ledger did not move by the amount, a record has no id, or the decline moved money", async () => {
      const cases: Array<[Parameters<typeof fakePayments>[0], string]> = [
        [{ moved: "  PASS  balances moved by $9: payer 120 to 111, friend 80 to 80" }, "the ledger did not move by $9: payer 120 to 111, friend 80 to 80"],
        [{ ids: "  payment ids: withdrawal undefined, deposit dp_1" }, "the payment's records have no ids (withdrawal undefined, deposit dp_1)"],
        [{ ids: "  nothing printed here" }, "the payment's records have no ids (none printed)"],
        [{ moved: "  PASS  balances moved by $0: payer 120 to 120, friend 80 to 80" }, "the friend's Muse sent the payment back, so nothing moved"],
        [{ moved: "  note  no balances line" }, "the confirm run never reported the balances moving"],
        [{ declineLine: "  FAIL  a decline moved nothing" }, "the decline run never confirmed that nothing moved"],
      ];
      for (const [overrides, expected] of cases) {
        const { code, text } = await gate(["--payments", "--runs", "1"], fakeDemo(), { paymentsScript: fakePayments(overrides) });
        expect(code, expected).toBe(1);
        expect(text, expected).toContain(`FAIL  payments, prepare then confirm and decline: ${expected}`);
        expect(text).toContain("demo:payments output");
      }
    });

    it("--payments reports the script's own failed checks, and does not run the decline after a failed confirm", async () => {
      const failing = fakeScript("payments", { confirm: "  FAIL  the payer's Muse prepared a payment (timed out)" }, 1);
      const { code, text } = await gate(["--payments", "--runs", "1"], fakeDemo(), { paymentsScript: failing });
      expect(code).toBe(1);
      expect(text).toContain("FAIL  payments, prepare then confirm and decline: confirm run: the payer's Muse prepared a payment (timed out)");
      expect(scriptRuns).toEqual([{ name: "payments", decline: false }]);
    });

    it("--payments is a SKIP, not a failure, when the script or the app's route is absent", async () => {
      const noScript = await gate(["--payments", "--runs", "1"], fakeDemo(), { paymentsScript: fileMissing });
      expect(noScript.code).toBe(0);
      expect(noScript.text).toContain("SKIP  payments, prepare then confirm and decline: demo:payments is not in this build");
      expect(noScript.text).toContain("C5 GATE: PASS (7 steps, 1 skipped) against");

      paymentsRoute = 404;
      const noRoute = await gate(["--payments", "--runs", "1"], fakeDemo(), { paymentsScript: fakePayments() });
      expect(noRoute.code).toBe(0);
      expect(noRoute.text).toContain("SKIP  payments, prepare then confirm and decline: the app has no payments route");
      expect(scriptRuns).toEqual([]);
    });

    it("--group runs the script once and passes on three accepted decisions and a confirmed plan", async () => {
      const { code, lines, text } = await gate(["--group", "--runs", "1"], fakeDemo(), { groupScript: fakeGroup() });
      expect(code).toBe(0);
      expect(scriptRuns).toEqual([{ name: "group", decline: false }]);
      expect(lines.find((entry) => entry.includes("group of three"))).toMatch(/^PASS {2}group of three, three decisions and a confirmed plan \(three decisions accepted \(aaron:accepted lisa:accepted kai:accepted\), plan confirmed, 41\.2s from the reel, /);
      expect(text).toContain("C5 GATE: PASS (8 steps) against");
    });

    it("--group fails when the plan did not confirm (a model declined), fewer than three accepted, or the script failed", async () => {
      const declined = await gate(["--group", "--runs", "1"], fakeDemo(), { groupScript: fakeGroup({ confirmed: "  note  a model said no; the plan drops, which is a valid run. Stopping here.", members: "", note: "" }) });
      expect(declined.code).toBe(1);
      expect(declined.text).toContain("FAIL  group of three, three decisions and a confirmed plan: a model declined, so the plan of three did not confirm (run it again)");

      const two = await gate(["--group", "--runs", "1"], fakeDemo(), { groupScript: fakeGroup({ members: "  PASS  every member accepted (aaron:accepted lisa:accepted kai:pending)" }) });
      expect(two.code).toBe(1);
      expect(two.text).toContain("FAIL  group of three, three decisions and a confirmed plan: 2 of 3 decisions accepted (aaron:accepted lisa:accepted kai:pending)");

      const crashed = await gate(["--group", "--runs", "1"], fakeDemo(), { groupScript: fakeScript("group", { confirm: "  FAIL  POST /api/signals {scenario: group} answered 202 in 4ms" }, 1) });
      expect(crashed.code).toBe(1);
      expect(crashed.text).toContain("run: POST /api/signals {scenario: group} answered 202 in 4ms");
    });

    it("--group says SKIP with the reason when this build has no demo:group or the app has no group route", async () => {
      const noScript = await gate(["--group", "--runs", "1"], fakeDemo(), { groupScript: fileMissing });
      expect(noScript.code).toBe(0);
      expect(noScript.text).toContain("SKIP  group of three, three decisions and a confirmed plan: demo:group is not in this build (scripts/demo-group.mjs is missing; it lands with PRs 27 and 33)");

      groupRoute = 404;
      const noRoute = await gate(["--group", "--runs", "1"], fakeDemo(), { groupScript: fakeGroup() });
      expect(noRoute.code).toBe(0);
      expect(noRoute.text).toContain("SKIP  group of three, three decisions and a confirmed plan: the app has no group route (GET /api/simulated-member answered 404; it lands with PRs 27 and 33)");
      expect(noRoute.text).toContain("C5 GATE: PASS (7 steps, 1 skipped) against");
      expect(scriptRuns).toEqual([]);
    });

    it("both flags together run payments before group and still leave the room reset last", async () => {
      const { code, lines, text } = await gate(["--payments", "--group", "--runs", "1"], fakeDemo(), { paymentsScript: fakePayments(), groupScript: fakeGroup() });
      expect(code).toBe(0);
      expect(scriptRuns.map((run) => `${run.name}${run.decline ? ":decline" : ""}`)).toEqual(["payments", "payments:decline", "group"]);
      const names = lines.map((line) => line.replace(/^(PASS|FAIL|SKIP) {2}/, ""));
      const at = (prefix: string) => names.findIndex((name) => name.startsWith(prefix));
      expect(at("payments, prepare")).toBeLessThan(at("group of three"));
      expect(at("group of three")).toBeLessThan(at("demo room left reset"));
      expect(text).toContain("C5 GATE: PASS (9 steps) against");
      expect(roomIsEmpty(room)).toBe(true);
    });
  });
});

describe("reading demo:payments and demo:group", () => {
  const confirm = (moved: string, ids = "  payment ids: withdrawal wd_1, deposit dp_1") => ["  PASS  confirm accepted (200)", moved, ids, "ALL CHECKS PASSED"].join("\n");

  it("checks the ledger arithmetic itself and wants an id on both records", () => {
    expect(paymentsConfirmResult(0, confirm("  PASS  balances moved by $12: payer 120 to 108, friend 80 to 92")).ok).toBe(true);
    expect(paymentsConfirmResult(0, confirm("  PASS  balances moved by $12: payer 120 to 109, friend 80 to 92")).detail).toContain("did not move by $12");
    expect(paymentsConfirmResult(0, confirm("  PASS  balances moved by $12: payer 120 to 108, friend 80 to 91")).ok).toBe(false);
    expect(paymentsConfirmResult(0, confirm("  PASS  balances moved by $12: payer 120 to 108, friend 80 to 92", "  payment ids: withdrawal wd_1, deposit null")).detail).toContain("no ids");
    expect(paymentsConfirmResult(0, confirm("  PASS  balances moved by $12: payer 120 to 108, friend 80 to 92", "  payment ids: withdrawal wd_1, refund rf_1")).ok).toBe(true);
    expect(paymentsConfirmResult(1, "  FAIL  settle started (500)").detail).toBe("confirm run: settle started (500)");
    expect(paymentsConfirmResult(2, "The room is not empty").detail).toBe("confirm run: the room was not empty");
  });

  it("wants the decline run to say nothing moved", () => {
    expect(paymentsDeclineResult(0, "  PASS  a decline moved nothing\nALL CHECKS PASSED").ok).toBe(true);
    expect(paymentsDeclineResult(0, "ALL CHECKS PASSED").ok).toBe(false);
    expect(paymentsDeclineResult(1, "  FAIL  decline accepted (500)").detail).toBe("decline run: decline accepted (500)");
  });

  it("wants three accepted decisions and a confirmed plan from the group run", () => {
    const good = ["  PASS  plan confirmed by all three (confirmed)", "  PASS  every member accepted (aaron:accepted lisa:accepted kai:accepted)", "  total 41.2s from the reel to a confirmed plan of three"].join("\n");
    expect(groupResult(0, good)).toEqual({ ok: true, detail: "three decisions accepted (aaron:accepted lisa:accepted kai:accepted), plan confirmed, 41.2s from the reel" });
    expect(groupResult(0, good.replace("kai:accepted", "kai:pending")).detail).toBe("2 of 3 decisions accepted (aaron:accepted lisa:accepted kai:pending)");
    expect(groupResult(0, "  note  a model said no; the plan drops").ok).toBe(false);
    expect(groupResult(0, "").detail).toBe("the plan of three never reached confirmed");
    expect(groupResult(2, "").detail).toBe("run: the room was not empty");
  });

  it("parses the two new flags, off by default", () => {
    expect(parseArgs([])).toMatchObject({ payments: false, group: false });
    expect(parseArgs(["--payments", "--group"])).toMatchObject({ payments: true, group: true });
  });
});
