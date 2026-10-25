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
  parseArgs,
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

describe("runGate end to end", () => {
  let server: Server;
  let base: string;
  let room: Room;
  let health: { status: number; body: unknown };
  let replay: unknown;
  let controls: Array<Record<string, unknown>>;
  let demoRuns: number;
  let dir: string;

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
    dir = mkdtempSync(path.join(tmpdir(), "muse-gate-"));
    server = createServer(async (request, response) => {
      const send = (status: number, body: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      if (request.method === "GET" && request.url === "/api/health") return send(health.status, health.body);
      if (request.method === "GET" && request.url === "/api/state") return send(200, room);
      if (request.method === "GET" && request.url === "/api/replay") return send(200, replay);
      if (request.method === "POST" && request.url === "/api/controls") {
        const body = JSON.parse((await readBody(request)) || "{}");
        controls.push(body);
        if (body.type === "reset") Object.assign(room, { plan: null, messages: [] });
        if (body.type === "simulated_friend") room.simulatedFriend = body.on;
        return send(200, { data: {}, error: null });
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

  async function gate(args: string[], demoScript: string) {
    const lines: string[] = [];
    const code = await runGate({ ...parseArgs(["--base", base, ...args]), demoScript }, (line: string) => lines.push(line));
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
    setTimeout(() => (room.inFlight = undefined), 700);
    const waited = await gate(["--force", "--runs", "1"], fakeDemo());
    expect(waited.code).toBe(0);
    expect(waited.text).toContain("PASS  no agent turn is running (it finished");

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
});
