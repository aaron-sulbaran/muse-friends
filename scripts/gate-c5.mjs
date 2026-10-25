#!/usr/bin/env node
// The C5 and C6 gate in one command, against any running copy of the app.
//
//   pnpm gate:c5 --base https://www.musefriends.tech
//   pnpm gate:c5 --base http://localhost:3001 --runs 1
//
// Options: --base URL        (default https://www.musefriends.tech; use the www address)
//          --expect-sha SHA  fail unless the deployed commit starts with SHA (production serves the build you mean)
//          --runs N          how many times to run the scenario (default 2)
//          --timeout SECONDS per run, passed to demo:http (default 120)
//          --force           clear the demo room even if it holds a plan or messages
//          --verbose         print each demo:http run in full, not only when it fails
//          --payments        also run the payments flow (demo:payments) twice: prepare then confirm, and prepare then
//                            decline; checks the ledger moved by the amount and the payment's records have ids
//          --group           also run demo:group once: three Muses, three decisions, a confirmed plan; SKIP, with the
//                            reason, when this build or the app has no group route
//
// In order: health and the deployed commit; the demo room is free; the simulated friend is off; the shawarma
// scenario through scripts/demo-http.mjs N times (each run is one PASS or FAIL line); the privacy toggle
// check that demo:http performs, once per run; Replay parses and carries its messages; and the demo room is
// left reset. One PASS or FAIL line per step. Exit 0 when every step passes, 1 when any fails, 2 when the
// room is not empty and --force was not given (nothing was touched). With --payments or --group, one more line
// each (PASS, FAIL, or SKIP when the feature is absent) comes after Replay and before the final reset; without
// the flags the output is exactly as before.
//
// It only ever resets the demo room (the one room the app has), through the app's own controls route, and
// it spends real Muse Spark calls: do not run it while a judge or a teammate is using the room.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export function parseArgs(argv) {
  const options = {
    base: process.env.GATE_BASE_URL ?? "https://www.musefriends.tech",
    expectSha: null,
    runs: 2,
    timeout: 120,
    force: false,
    verbose: false,
    idleWaitMs: 20_000,
    demoScript: path.join(here, "demo-http.mjs"),
    payments: false,
    group: false,
    paymentsScript: path.join(here, "demo-payments.mjs"),
    groupScript: path.join(here, "demo-group.mjs"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => argv[++index];
    if (argument === "--base") options.base = value();
    else if (argument === "--expect-sha") options.expectSha = value();
    else if (argument === "--runs") options.runs = Number(value());
    else if (argument === "--timeout") options.timeout = Number(value());
    else if (argument === "--force") options.force = true;
    else if (argument === "--verbose") options.verbose = true;
    else if (argument === "--payments") options.payments = true;
    else if (argument === "--group") options.group = true;
    else if (argument === "--demo-script") options.demoScript = value(); // for tests
    else if (argument === "--payments-script") options.paymentsScript = value(); // for tests
    else if (argument === "--group-script") options.groupScript = value(); // for tests
  }
  options.base = options.base.replace(/\/$/, "");
  if (!Number.isInteger(options.runs) || options.runs < 1) options.runs = 2;
  if (!Number.isFinite(options.timeout) || options.timeout < 1) options.timeout = 120;
  return options;
}

// ---------------------------------------------------------------------------
// Pure checks, so they can be tested without a server
// ---------------------------------------------------------------------------

export function checkHealth(status, body, expectedSha) {
  if (status !== 200) return { ok: false, detail: `HTTP ${status}` };
  if (!body || body.ok !== true) return { ok: false, detail: `the health route did not answer ok (${JSON.stringify(body)?.slice(0, 80)})` };
  const sha = typeof body.sha === "string" ? body.sha : "";
  if (!sha) return { ok: false, detail: "the health route exposes no commit sha" };
  if (expectedSha && sha.slice(0, 7) !== expectedSha.slice(0, 7)) {
    return { ok: false, detail: `deployed commit ${sha}, expected ${expectedSha.slice(0, 7)}` };
  }
  return { ok: true, detail: `commit ${sha}` };
}

// A room is free when it holds no plan and no messages (the test demo:http applies) and no agent turn
// is running: a turn started a moment ago has not written its plan yet, but it will.
export function roomIsEmpty(state) {
  return !state?.plan && (state?.messages ?? []).length === 0 && !state?.inFlight;
}

export function describeRoom(state) {
  const turn = state?.inFlight ? ", an agent turn is running" : "";
  return `plan ${state?.plan?.state ?? "none"}, ${(state?.messages ?? []).length} messages${turn}`;
}

// The Replay endpoint answers { data: { id, label, source, frames: [{ snapshot, holdMs }] }, error }.
// "Parses and has its messages": every frame is a replay-mode snapshot, the hold times are numbers, and
// the last frame carries a whole conversation (at least three messages, numbered 1, 2, 3 in order).
export function checkReplay(payload) {
  const data = payload?.data;
  if (payload?.error || !data) return { ok: false, detail: `no recorded run (${JSON.stringify(payload?.error ?? payload)?.slice(0, 80)})` };
  if (!data.id || !data.label || !["live", "scripted"].includes(data.source)) return { ok: false, detail: "the run has no id, label, or source" };
  const frames = data.frames;
  if (!Array.isArray(frames) || frames.length < 2) return { ok: false, detail: `only ${Array.isArray(frames) ? frames.length : 0} frame(s)` };
  for (const [index, frame] of frames.entries()) {
    if (typeof frame?.holdMs !== "number" || frame.holdMs < 0) return { ok: false, detail: `frame ${index} has no hold time` };
    if (frame?.snapshot?.mode !== "replay") return { ok: false, detail: `frame ${index} is not a replay snapshot (${frame?.snapshot?.mode})` };
    if (!Array.isArray(frame.snapshot.messages)) return { ok: false, detail: `frame ${index} has no messages array` };
  }
  const messages = frames.at(-1).snapshot.messages;
  if (messages.length < 3) return { ok: false, detail: `the last frame holds ${messages.length} message(s), expected at least 3` };
  const sequence = messages.map((message) => message.seq);
  if (!sequence.every((seq, index) => seq === index + 1)) return { ok: false, detail: `message numbers are ${sequence.join(",")}, expected 1..${messages.length}` };
  return { ok: true, detail: `${data.source} run "${data.label}", ${frames.length} frames, ${messages.length} messages` };
}

// demo:http prints the privacy toggle check as its own PASS or FAIL line.
export function privacyResult(output) {
  const match = output.match(/^\s+(PASS|FAIL)\s+(location redacted on .*)$/m);
  if (!match) return { ok: false, detail: "demo:http never reached the privacy toggle check" };
  return { ok: match[1] === "PASS", detail: match[2] };
}

export function demoResult(code, output) {
  const agreed = output.match(/agents agreed in (\d+) messages at ([\d.]+s)/);
  const timing = agreed ? `agreed in ${agreed[1]} messages at ${agreed[2]}` : "";
  if (code === 0) return { ok: true, detail: timing };
  const failed = [...output.matchAll(/^\s+FAIL\s+(.+)$/gm)].map((match) => match[1]);
  const reason = code === 2 ? "the room was not empty" : failed.length > 0 ? failed.join("; ") : `exit code ${code}`;
  return { ok: false, detail: reason };
}

// demo:payments prepares a payment, then confirms it (or declines it with --decline). The confirm run prints the
// balances before and after and the ids of the records it wrote; the gate reads those lines and checks them again
// for itself, so a script that only says PASS is not enough: the ledger must have moved by the amount, on both
// sides, and the withdrawal and the deposit must each have an id.
const MISSING_ID = new Set(["undefined", "null", "none", "nan"]);

export function paymentsConfirmResult(code, output) {
  if (code !== 0) return failedRun("confirm run", code, output);
  const moved = output.match(/^\s+PASS\s+balances moved by \$(\d+): payer (\d+) to (\d+), friend (\d+) to (\d+)\s*$/m);
  if (!moved) return { ok: false, detail: "the confirm run never reported the balances moving" };
  const [amount, payerBefore, payerAfter, friendBefore, friendAfter] = moved.slice(1).map(Number);
  if (amount < 1) return { ok: false, detail: "the friend's Muse sent the payment back, so nothing moved (run it again)" };
  if (payerAfter !== payerBefore - amount || friendAfter !== friendBefore + amount) {
    return { ok: false, detail: `the ledger did not move by $${amount}: payer ${payerBefore} to ${payerAfter}, friend ${friendBefore} to ${friendAfter}` };
  }
  const ids = output.match(/^\s+payment ids: withdrawal (\S+), (?:deposit|refund) (\S+)\s*$/m);
  if (!ids || MISSING_ID.has(ids[1].toLowerCase()) || MISSING_ID.has(ids[2].toLowerCase())) {
    return { ok: false, detail: `the payment's records have no ids (${ids ? `withdrawal ${ids[1]}, deposit ${ids[2]}` : "none printed"})` };
  }
  return { ok: true, detail: `confirm moved $${amount} (payer ${payerBefore} to ${payerAfter}, friend ${friendBefore} to ${friendAfter}; withdrawal ${ids[1]}, deposit ${ids[2]})` };
}

export function paymentsDeclineResult(code, output) {
  if (code !== 0) return failedRun("decline run", code, output);
  if (!/^\s+PASS\s+a decline moved nothing\s*$/m.test(output)) return { ok: false, detail: "the decline run never confirmed that nothing moved" };
  return { ok: true, detail: "decline moved nothing" };
}

// demo:group runs a plan of three through to a confirmed plan. A model may decline, which the script treats as a
// valid run and stops; the gate wants the plan, so that is a FAIL with its own reason.
export function groupResult(code, output) {
  if (code !== 0) return failedRun("run", code, output);
  const confirmed = /^\s+PASS\s+plan confirmed by all three \(confirmed\)\s*$/m.test(output);
  if (!confirmed) {
    const declined = /a model said no/.test(output);
    return { ok: false, detail: declined ? "a model declined, so the plan of three did not confirm (run it again)" : "the plan of three never reached confirmed" };
  }
  const members = output.match(/^\s+PASS\s+every member accepted \((.+)\)\s*$/m);
  const accepted = members ? [...members[1].matchAll(/(\S+):accepted/g)].length : 0;
  if (accepted !== 3) return { ok: false, detail: `${accepted} of 3 decisions accepted${members ? ` (${members[1]})` : ""}` };
  const total = output.match(/total ([\d.]+s) from the reel/);
  return { ok: true, detail: `three decisions accepted (${members[1]}), plan confirmed${total ? `, ${total[1]} from the reel` : ""}` };
}

function failedRun(label, code, output) {
  const failed = [...output.matchAll(/^\s+FAIL\s+(.+)$/gm)].map((match) => match[1]);
  const reason = code === 2 ? "the room was not empty" : failed.length > 0 ? failed.join("; ") : `exit code ${code}`;
  return { ok: false, detail: `${label}: ${reason}` };
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;

async function getJson(base, route) {
  const started = Date.now();
  const response = await fetch(`${base}${route}`);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text.slice(0, 120) };
  }
  return { status: response.status, body, ms: Date.now() - started };
}

async function postControls(base, body) {
  const response = await fetch(`${base}/api/controls`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return response.status;
}

// Whether the app has a route: a route that only takes POST answers a GET with 405, a route that is not there
// with 404. Null when the app did not answer at all. Nothing is created.
async function routeExists(base, route) {
  try {
    const response = await fetch(`${base}${route}`);
    await response.text();
    return response.status !== 404;
  } catch {
    return null;
  }
}

// Waits until no agent turn is running, so a straggler cannot write into the room after it is cleared.
async function waitForIdle(base, limitMs, pollMs = 500) {
  const deadline = Date.now() + limitMs;
  for (;;) {
    const state = (await getJson(base, "/api/state")).body;
    if (!state?.inFlight) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

function runDemo(options, signalTimeoutMs) {
  return runScript([options.demoScript, "--base", options.base, "--runs", "1", "--timeout", String(options.timeout), "--force"], signalTimeoutMs);
}

// Runs one of the demo scripts as its own node process and collects what it prints. Killed at the limit.
function runScript(args, signalTimeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => child.kill("SIGKILL"), signalTimeoutMs);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ code: signal ? 124 : (code ?? 1), output });
    });
  });
}

export async function runGate(options, write = (line) => console.log(line)) {
  const steps = [];
  let skipped = 0;
  const record = (ok, label, detail = "") => {
    steps.push({ ok, label });
    write(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? (ok ? ` (${detail})` : `: ${detail}`) : ""}`);
    return ok;
  };
  // A step that cannot run because the feature is not in this build or this app. Not a failure, not counted as a step.
  const skip = (label, reason) => {
    skipped += 1;
    write(`SKIP  ${label}: ${reason}`);
  };
  const finish = (code) => {
    const failed = steps.filter((step) => !step.ok).length;
    const skips = skipped > 0 ? `, ${skipped} skipped` : "";
    write(failed === 0 ? `C5 GATE: PASS (${steps.length} steps${skips}) against ${options.base}` : `C5 GATE: FAIL (${failed} of ${steps.length} steps failed${skips}) against ${options.base}`);
    return code ?? (failed === 0 ? 0 : 1);
  };
  const showOutput = (title, output, always = false) => {
    if (!output.trim()) return;
    const lines = output.trimEnd().split("\n");
    const shown = always ? lines : lines.slice(-30);
    write(`      ${title} output${always || lines.length <= 30 ? "" : " (last 30 lines)"}:`);
    for (const line of shown) write(`      | ${line}`);
  };

  write(`C5 gate against ${options.base}`);

  // 1. Health and the deployed commit.
  let health;
  try {
    health = await getJson(options.base, "/api/health");
  } catch (error) {
    record(false, "health answers", `no answer: ${error instanceof Error ? error.message : error}`);
    return finish(1);
  }
  const healthCheck = checkHealth(health.status, health.body, options.expectSha);
  record(healthCheck.ok, "health answers ok with the deployed commit", `${healthCheck.detail}, ${seconds(health.ms)}`);
  if (!healthCheck.ok) return finish(1);

  // 2. The demo room is free, unless we were told to clear it.
  let state;
  try {
    state = (await getJson(options.base, "/api/state")).body;
  } catch (error) {
    record(false, "the demo room is readable", error instanceof Error ? error.message : String(error));
    return finish(1);
  }
  if (!roomIsEmpty(state) && !options.force) {
    record(false, "the demo room is free", `it holds ${describeRoom(state)} and would be cleared; pass --force once nobody is using it`);
    return finish(2);
  }
  record(true, "the demo room is free", roomIsEmpty(state) ? "empty" : `${describeRoom(state)}, --force given`);
  if (state?.inFlight) {
    const idle = await waitForIdle(options.base, options.idleWaitMs);
    if (!record(idle, "no agent turn is running", idle ? "it finished" : `one is still running after ${seconds(options.idleWaitMs)}`)) return finish(1);
  }

  // 3. The simulated friend is off, because demo:http taps both people itself.
  if (state?.simulatedFriend) {
    const status = await postControls(options.base, { type: "simulated_friend", on: false });
    record(status === 200, "simulated friend turned off", status === 200 ? "it was on" : `HTTP ${status}`);
  } else {
    record(true, "simulated friend is off");
  }

  // 4. The scenario, N times, each with its privacy toggle check.
  const perRunMs = (options.timeout + 90) * 1000;
  for (let run = 1; run <= options.runs; run += 1) {
    const started = Date.now();
    const result = await runDemo(options, perRunMs);
    const demo = demoResult(result.code, result.output);
    record(demo.ok, `demo:http run ${run} of ${options.runs}`, demo.ok ? `${demo.detail ? `${demo.detail}, ` : ""}${seconds(Date.now() - started)}` : demo.detail);
    const privacy = privacyResult(result.output);
    record(privacy.ok, `privacy toggle, run ${run}`, privacy.detail);
    if ((!demo.ok || !privacy.ok || options.verbose) && result.output.trim()) {
      const lines = result.output.trimEnd().split("\n");
      const shown = options.verbose ? lines : lines.slice(-30);
      write(`      demo:http output${options.verbose || lines.length <= 30 ? "" : " (last 30 lines)"}:`);
      for (const line of shown) write(`      | ${line}`);
    }
  }

  // 5. Replay parses and carries its messages.
  try {
    const replay = await getJson(options.base, "/api/replay");
    const checked = replay.status === 200 ? checkReplay(replay.body) : { ok: false, detail: `HTTP ${replay.status}` };
    record(checked.ok, "Replay parses and carries its messages", `${checked.detail}${checked.ok ? `, ${seconds(replay.ms)}` : ""}`);
  } catch (error) {
    record(false, "Replay parses and carries its messages", error instanceof Error ? error.message : String(error));
  }

  // 5b. Opt-in: the payments flow, prepared and confirmed, then prepared and declined.
  if (options.payments) {
    const label = "payments, prepare then confirm and decline";
    if (!existsSync(options.paymentsScript)) {
      skip(label, "demo:payments is not in this build (scripts/demo-payments.mjs is missing)");
    } else {
      const present = await routeExists(options.base, "/api/plans/gate_probe/settle");
      if (present === null) {
        record(false, label, "the app did not answer the route check");
      } else if (!present) {
        skip(label, "the app has no payments route (POST /api/plans/[id]/settle answered 404)");
      } else {
        const started = Date.now();
        const limit = (options.timeout + 90) * 1000;
        const base = [options.paymentsScript, "--base", options.base, "--timeout", String(options.timeout), "--force"];
        const confirm = await runScript(base, limit);
        const confirmed = paymentsConfirmResult(confirm.code, confirm.output);
        let declined = { ok: false, detail: "not run because the confirm run failed" };
        let decline = { output: "" };
        if (confirmed.ok) {
          await waitForIdle(options.base, options.idleWaitMs);
          decline = await runScript([...base, "--decline"], limit);
          declined = paymentsDeclineResult(decline.code, decline.output);
        }
        const ok = confirmed.ok && declined.ok;
        record(ok, label, ok ? `${confirmed.detail}; ${declined.detail}, ${seconds(Date.now() - started)}` : confirmed.ok ? declined.detail : confirmed.detail);
        if (!ok || options.verbose) showOutput("demo:payments", confirmed.ok ? decline.output : confirm.output, options.verbose);
      }
    }
  }

  // 5c. Opt-in: the group of three, once.
  if (options.group) {
    const label = "group of three, three decisions and a confirmed plan";
    if (!existsSync(options.groupScript)) {
      skip(label, "demo:group is not in this build (scripts/demo-group.mjs is missing; it lands with PRs 27 and 33)");
    } else {
      const present = await routeExists(options.base, "/api/simulated-member");
      if (present === null) {
        record(false, label, "the app did not answer the route check");
      } else if (!present) {
        skip(label, "the app has no group route (GET /api/simulated-member answered 404; it lands with PRs 27 and 33)");
      } else {
        await waitForIdle(options.base, options.idleWaitMs);
        const started = Date.now();
        const result = await runScript([options.groupScript, "--base", options.base, "--runs", "1", "--timeout", String(options.timeout), "--force"], (options.timeout + 90) * 1000);
        const checked = groupResult(result.code, result.output);
        record(checked.ok, label, checked.ok ? `${checked.detail}, ${seconds(Date.now() - started)}` : checked.detail);
        if (!checked.ok || options.verbose) showOutput("demo:group", result.output, options.verbose);
      }
    }
  }

  // 6. Leave the demo room reset, whatever happened above.
  let left = null;
  try {
    await waitForIdle(options.base, options.idleWaitMs);
    left = (await getJson(options.base, "/api/state")).body;
    if (!roomIsEmpty(left) || left?.simulatedFriend) {
      await postControls(options.base, { type: "reset" });
      if (left?.simulatedFriend) await postControls(options.base, { type: "simulated_friend", on: false });
      await waitForIdle(options.base, options.idleWaitMs);
      left = (await getJson(options.base, "/api/state")).body;
    }
  } catch {
    left = null;
  }
  const clean = left !== null && roomIsEmpty(left) && !left.simulatedFriend;
  record(clean, "demo room left reset", clean ? "empty, simulated friend off" : left === null ? "could not read the room" : `still ${describeRoom(left)}, simulated friend ${left.simulatedFriend ? "on" : "off"}`);

  return finish();
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  runGate(parseArgs(process.argv.slice(2))).then((code) => process.exit(code));
}
