#!/usr/bin/env node
// One judge alone runs a plan of three, over HTTP against a running app. A model plays Michelle (Mochi's person) and
// Kai (Pebble's person), the same way the stage does when it asks the simulated-friend and simulated-member routes;
// this script asks them the way the page's hooks do. Local or deployed, whatever store the app is configured with.
//
//   pnpm demo:group                                   http://localhost:3001
//   pnpm demo:group -- --base http://localhost:3001 --runs 1
//
// Options: --base URL  --runs N (default 1)  --keep (do not reset the room at the end)
//          --timeout SECONDS (default 180)  --force (start even if the room holds a plan; it will be cleared)
//
// It RESETS the room at the start of every run (and at the end unless --keep), so only point it at a room you are
// happy to clear. Exit code 1 if any check fails, 2 if the room is busy.

const argv = process.argv.slice(2);
function option(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (argv[index + 1] ?? fallback);
}
const base = option("base", process.env.DEMO_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const runs = Number(option("runs", "1"));
const keep = argv.includes("--keep");
const force = argv.includes("--force");
const timeoutMs = Number(option("timeout", "180")) * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (ms) => `${(ms / 1000).toFixed(1)}s`;
const failures = [];
function check(ok, label) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures.push(label);
  return ok;
}

async function call(method, path, body) {
  const started = Date.now();
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: response.status, ms: Date.now() - started, json };
}

let etag = null;
async function state() {
  const response = await fetch(`${base}/api/state`, { headers: etag ? { "if-none-match": etag } : {} });
  if (response.status === 304) return null;
  etag = response.headers.get("etag");
  return response.json();
}

async function waitFor(label, test) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = (await state()) ?? last;
    if (last && test(last)) return last;
    if (last?.failure) return last;
    await sleep(250);
  }
  return last;
}

async function runHangout(label) {
  console.log(`\nDEMO group, one judge alone, ${label} against ${base}`);
  const reset = await call("POST", "/api/controls", { type: "reset" });
  check(reset.status === 200, `reset the room (${reset.status}, ${reset.ms}ms)`);
  const alone = await call("POST", "/api/controls", { type: "simulated_friend", on: true });
  check(alone.status === 200, `Michelle on for the room (${alone.status})`);
  etag = null;

  const t0 = Date.now();
  const ack = await call("POST", "/api/signals", { scenario: "group" });
  if (ack.status === 429) console.log(`  The room is paused by a run cap (${ack.json?.reason}): "${ack.json?.text}".`);
  check(ack.status === 202, `POST /api/signals {scenario: group} answered 202 in ${ack.ms}ms`);
  if (ack.status !== 202) return null;
  const { planId } = ack.json;

  let snapshot = await waitFor("agents agree", (s) => s.plan?.id === planId && (s.plan.state === "awaiting_humans" || s.plan.state === "dropped"));
  check(snapshot?.plan?.state === "awaiting_humans", `the three Muses reached awaiting_humans in ${seconds(Date.now() - t0)} (was ${snapshot?.plan?.state ?? "none"})`);
  if (snapshot?.plan?.state !== "awaiting_humans") return null;

  // The page asks both routes once the plan is waiting on them; Michelle answers first, then Kai.
  const [michelle, kai] = await Promise.all([
    call("POST", "/api/simulated-friend", { planId }),
    call("POST", "/api/simulated-member", { planId, member: "kai" }),
  ]);
  check(michelle.status === 200 && ["accept", "decline"].includes(michelle.json?.data?.choice), `Michelle, played by a model, answered ${michelle.json?.data?.choice ?? michelle.status} (${seconds(michelle.ms)})`);
  check(kai.status === 200 && ["accept", "decline"].includes(kai.json?.data?.choice), `Kai, played by a model, answered ${kai.json?.data?.choice ?? kai.status} (${seconds(kai.ms)})`);
  const again = await call("POST", "/api/simulated-member", { planId, member: "kai" });
  check(again.status === 409, `a second ask for Kai finds nothing waiting (${again.status})`);
  if (michelle.json?.data?.choice !== "accept" || kai.json?.data?.choice !== "accept") {
    console.log("  note  a model said no; the plan drops, which is a valid run. Stopping here.");
    return { last: await state() };
  }

  const judge = await call("POST", `/api/plans/${planId}/decision`, { role: "a", choice: "accept" });
  check(judge.status === 200, `the judge accepted (${judge.status})`);
  etag = null;
  const now = await state();
  check(now.plan?.state === "confirmed", `plan confirmed by all three (${now.plan?.state})`);
  const decisions = now.plan?.group?.members?.map((member) => `${member.id}:${member.decision}`).join(" ");
  check(now.plan?.group?.members?.every((member) => member.decision === "accepted"), `every member accepted (${decisions})`);
  console.log(`  total ${seconds(Date.now() - t0)} from the reel to a confirmed plan of three`);
  return { last: now };
}

const initial = await state();
if (!force && initial && (initial.plan || initial.messages.length > 0)) {
  console.log(`The room at ${base} is not empty (plan ${initial.plan?.state ?? "none"}, ${initial.messages.length} messages). Pass --force to clear it and run anyway.`);
  process.exit(2);
}
etag = null;

for (let index = 1; index <= runs; index += 1) {
  try {
    await runHangout(`run ${index}/${runs}`);
  } catch (error) {
    check(false, `run ${index} threw: ${error instanceof Error ? error.message : error}`);
  }
}
if (!keep) {
  const cleared = await call("POST", "/api/controls", { type: "reset" });
  check(cleared.status === 200, "room reset at the end");
}
console.log(failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED:\n  - ${failures.join("\n  - ")}`);
process.exit(failures.length === 0 ? 0 : 1);
