#!/usr/bin/env node
// The shawarma scenario driven over HTTP against a running app, local or deployed. This is the C3 check:
// it hits the real routes, the real Muse Spark loops, and whatever store the app is configured with.
//
//   pnpm demo:http                                         http://localhost:3001
//   pnpm demo:http -- --base https://muse-friends.vercel.app --runs 2
//
// Options: --base URL  --runs N (default 1)  --privacy after|before|none (default after)
//          --keep (do not reset the room at the end)  --timeout SECONDS (default 120)
//          --force (start even if the room already holds a plan or messages; it will be cleared)
//          --target ID  run the weak-tie follow-up with a seeded contact instead of the reel (jules is mutual,
//                       riley is not and must be refused); privacy then defaults to none
//
// It uses the same public routes the phones use: POST /api/signals, GET /api/state (with the ETag),
// POST /api/plans/[id]/decision and /draft, POST /api/clock, POST /api/controls. It RESETS the room at the
// start of every run (and at the end unless --keep), so only point it at a room you are happy to clear.
// Exit code 1 if any check fails.

const argv = process.argv.slice(2);
function option(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (argv[index + 1] ?? fallback);
}
const base = (option("base", process.env.DEMO_BASE_URL ?? "http://localhost:3001")).replace(/\/$/, "");
const runs = Number(option("runs", "1"));
const target = option("target", null);
const privacy = option("privacy", target ? "none" : "after");
const keep = argv.includes("--keep");
const timeoutMs = Number(option("timeout", "120")) * 1000;
const force = argv.includes("--force");

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

const nameOf = (snapshot, id) => snapshot?.sides?.[id] ?? id;

async function run(label) {
  console.log(`\nDEMO ${label} against ${base}`);
  const reset = await call("POST", "/api/controls", { type: "reset" });
  check(reset.status === 200, `reset the room (${reset.status}, ${reset.ms}ms)`);
  etag = null;

  if (privacy === "before") {
    const toggled = await call("POST", "/api/controls", { type: "privacy", side: "b", category: "location", on: false });
    check(toggled.status === 200, `location off for Mochi before the run (${toggled.status})`);
  }

  // 1. The reel arrives.
  const t0 = Date.now();
  const ack = await call("POST", "/api/signals", target ? { scenario: "follow_up", target } : {});
  if (target && ack.status === 409) {
    // The gate: no mutual follow, no thread. The refusal is logged and nothing else starts.
    check(ack.json?.reason === "not_mutual", `refused with reason ${ack.json?.reason}: "${ack.json?.text}"`);
    await sleep(1500);
    etag = null;
    const after = await state();
    check(after.messages.length === 0, `no messages were sent (${after.messages.length})`);
    check(after.plan?.state === "dropped", `plan dropped (${after.plan?.state})`);
    check(!after.inFlight, "no agent turn is running");
    return { refused: true, messages: [], agreedMs: 0, rows: [], last: after };
  }
  check(ack.status === 202, `POST /api/signals answered 202 in ${ack.ms}ms`);
  if (ack.status !== 202) return null;
  const { contextId, planId } = ack.json;

  // 2. The agents talk: watch the state until the plan settles.
  const arrivals = new Map();
  let snapshot = null;
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    snapshot = (await state()) ?? snapshot;
    if (snapshot) {
      for (const message of snapshot.messages.filter((m) => m.contextId === contextId)) {
        if (!arrivals.has(message.seq)) arrivals.set(message.seq, Date.now() - t0);
      }
      last = snapshot;
      if (snapshot.failure) break;
      const plan = snapshot.plan;
      if (plan && plan.contextId === contextId && (plan.state === "awaiting_humans" || plan.state === "dropped")) break;
    }
    await sleep(200);
  }
  const agreedMs = Date.now() - t0;
  const messages = (last?.messages ?? []).filter((m) => m.contextId === contextId).sort((a, b) => a.seq - b.seq);
  check(last?.plan?.state === "awaiting_humans", `plan reached awaiting_humans (was ${last?.plan?.state ?? "none"})${last?.failure ? `, failure: ${JSON.stringify(last.failure)}` : ""}`);
  check(messages.length > 0 && messages.length <= 4, `agreed within 4 messages (${messages.length})`);
  check(messages.every((m) => m.proof), "every message carries model proof");
  if (target) {
    const location = messages.filter((m) => (m.shared ?? []).includes("location") || m.activity?.place);
    check(location.length === 0, `no message carries a place or location (${location.length} did)`);
  }

  const rows = messages.map((m, index) => {
    const arrival = arrivals.get(m.seq) ?? 0;
    const previous = index > 0 ? (arrivals.get(messages[index - 1].seq) ?? 0) : 0;
    return { m, arrival, turn: arrival - previous };
  });
  console.log("  #  from    type    arrival  turn    send call  out tok  windows / note");
  for (const { m, arrival, turn } of rows) {
    const windows = (m.windows ?? []).length;
    console.log(
      `  ${m.seq}  ${String(nameOf(last, m.from)).padEnd(6)}  ${m.type.padEnd(6)}  ${seconds(arrival).padStart(7)}  ${seconds(turn).padStart(6)}  ${seconds(m.proof?.latencyMs ?? 0).padStart(9)}  ${String(m.proof?.outputTokens ?? "").padStart(7)}  ${windows} window(s)${m.note ? ` | "${m.note}"` : ""}  [shared: ${(m.shared ?? []).join(",") || "-"}; withheld: ${(m.removed ?? []).join(",") || "-"}]`,
    );
  }
  console.log(`  agents ${last?.plan?.state === "awaiting_humans" ? "agreed" : "did not agree"} in ${messages.length} messages at ${seconds(agreedMs)}`);
  if (last?.plan?.state !== "awaiting_humans") return { messages, agreedMs, rows, last };

  // 3. The people decide, open the draft, and the clock carries the plan to the follow-up.
  const [a, b] = await Promise.all([
    call("POST", `/api/plans/${planId}/decision`, { role: "a", choice: "accept" }),
    call("POST", `/api/plans/${planId}/decision`, { role: "b", choice: "accept" }),
  ]);
  check(a.status === 200 && b.status === 200, `both accepted at once (${a.status}/${b.status}, ${a.ms}ms/${b.ms}ms)`);
  let now = await state().then((s) => s ?? last);
  check(now.plan?.state === "confirmed", `plan confirmed (${now.plan?.state})`);
  const handoff = await call("POST", `/api/plans/${planId}/draft`, { role: "a", via: "whatsapp" });
  check(handoff.status === 200, `WhatsApp draft opened, hold issued (${handoff.status}, ${handoff.ms}ms)`);
  const reminder = await call("POST", "/api/clock", { action: "advance" });
  check(reminder.status === 200 && reminder.json?.data?.plan === "reminded", `clock to the reminder (${reminder.json?.data?.plan ?? reminder.status}, ${reminder.ms}ms)`);
  const nextDay = await call("POST", "/api/clock", { action: "advance" });
  check(nextDay.status === 200 && nextDay.json?.data?.plan === "followed_up", `clock to the next day (${nextDay.json?.data?.plan ?? nextDay.status}, ${nextDay.ms}ms)`);
  etag = null;
  now = await state();
  check(now.plan?.state === "followed_up", `plan followed_up (${now.plan?.state})`);
  check(now.followThrough?.events?.length === 1, `Follow-through counts ${now.followThrough?.events?.length} human event(s)`);

  // 4. The privacy toggle.
  let replayed = null;
  if (privacy === "after") {
    const toggled = await call("POST", "/api/controls", { type: "privacy", side: "b", category: "location", on: false });
    replayed = toggled.json?.data?.replayed ?? null;
    check(toggled.status === 200, `location off for Mochi after the run (${toggled.status}, ${toggled.ms}ms); messages replayed: ${replayed}`);
    etag = null;
    now = await state();
  }
  const withheld = now.messages.filter((m) => m.contextId === contextId && (m.removed ?? []).includes("location"));
  if (privacy !== "none") check(withheld.length > 0, `location redacted on ${withheld.length} message(s): ${withheld.map((m) => `#${m.seq} ${nameOf(now, m.from)}`).join(", ") || "none"}`);

  console.log(`  rows via the app: messages ${now.messages.filter((m) => m.contextId === contextId).length}, timeline notes ${now.notes?.length ?? "?"}, follow-through events ${now.followThrough?.events?.length}, agent messages ${now.followThrough?.agentMessageCount}, human taps ${now.followThrough?.humanTapCount}`);
  return { messages, agreedMs, rows, last: now, replayed };
}

// Someone may be using this room. Do not clear a plan that is not ours unless told to.
const initial = await state();
if (!force && initial && (initial.plan || initial.messages.length > 0)) {
  console.log(`The room at ${base} is not empty (plan ${initial.plan?.state ?? "none"}, ${initial.messages.length} messages). Pass --force to clear it and run anyway.`);
  process.exit(2);
}
etag = null;

const results = [];
for (let index = 1; index <= runs; index += 1) {
  try {
    results.push(await run(`run ${index}/${runs}`));
  } catch (error) {
    check(false, `run ${index} threw: ${error instanceof Error ? error.message : error}`);
  }
}
if (!keep) {
  const cleared = await call("POST", "/api/controls", { type: "reset" });
  check(cleared.status === 200, "room reset at the end");
}

const agreed = results.filter((r) => r && r.last?.plan).map((r) => r.agreedMs).sort((x, y) => x - y);
if (agreed.length > 0) console.log(`\nDEMO SUMMARY: ${results.length} run(s); time to agreement median ${seconds(agreed[Math.floor(agreed.length / 2)])} (min ${seconds(agreed[0])}, max ${seconds(agreed.at(-1))}); messages ${results.map((r) => r?.messages?.length ?? "-").join(", ")}`);
console.log(failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED:\n  - ${failures.join("\n  - ")}`);
process.exit(failures.length === 0 ? 0 : 1);
