#!/usr/bin/env node
// The shawarma scenario driven over HTTP against a running app, local or deployed. This is the C3 check:
// it hits the real routes, the real Muse Spark loops, and whatever store the app is configured with.
//
//   pnpm demo:http                                         http://localhost:3001
//   pnpm demo:http -- --base https://muse-friends.vercel.app --runs 2
//
// Options: --base URL  --runs N (default 1)  --privacy after|before|none (default after)
//          --scenario pair|group (default pair; group is Sprout, Mochi and Pebble agreeing on one window)
//          --keep (do not reset the room at the end)  --timeout SECONDS (default 120)
//          --force (start even if the room already holds a plan or messages; it will be cleared)
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
const privacy = option("privacy", "after");
const scenario = option("scenario", "pair");
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

// The room's two phone seats are named by the state; the group's third friend has no seat there.
const nameOf = (snapshot, id) => ({ aaron: snapshot?.sides?.a, lisa: snapshot?.sides?.b, kai: "Pebble" })[id] ?? snapshot?.sides?.[id] ?? id;

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
  const ack = await call("POST", "/api/signals", {});
  if (ack.status === 429) console.log(`  The room is paused by a run cap (${ack.json?.reason}): "${ack.json?.text}". Demo runs count against the caps too.`);
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
  const fallbacks = messages.filter((m) => !m.proof).length;
  check(fallbacks === 0, `every message carries model proof${fallbacks > 0 ? ` (${fallbacks} sent by the scripted fallback: the model could not reply)` : ""}`);

  const rows = messages.map((m, index) => {
    const arrival = arrivals.get(m.seq) ?? 0;
    const previous = index > 0 ? (arrivals.get(messages[index - 1].seq) ?? 0) : 0;
    return { m, arrival, turn: arrival - previous };
  });
  console.log("  #  from    type    arrival  turn    send call  out tok  windows / note");
  for (const { m, arrival, turn } of rows) {
    const windows = (m.windows ?? []).length;
    console.log(
      `  ${m.seq}  ${String(nameOf(last, m.from)).padEnd(6)}  ${m.type.padEnd(6)}  ${seconds(arrival).padStart(7)}  ${seconds(turn).padStart(6)}  ${seconds(m.proof?.latencyMs ?? 0).padStart(9)}  ${String(m.proof?.outputTokens ?? "").padStart(7)}  ${windows} window(s)${m.note ? ` | "${m.note}"` : ""}${m.proof ? "" : " (fallback, no model proof)"}  [shared: ${(m.shared ?? []).join(",") || "-"}; withheld: ${(m.removed ?? []).join(",") || "-"}]`,
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
  // The clock no longer counts a plan as followed through; only a person's "We went!" tap does.
  check(now.followThrough?.events?.length === 0, `the clock alone does not count it (${now.followThrough?.events?.length} event(s))`);
  const went = await call("POST", `/api/plans/${planId}/outcome`, { role: "a", result: "went" });
  check(went.status === 200, `"We went!" tapped (${went.status}, ${went.ms}ms)`);
  etag = null;
  now = await state();
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


// The group of three: Sprout makes the reel a plan for Mochi and Pebble. One pair thread per friend, one plan.
async function runGroup(label) {
  console.log(`\nDEMO group ${label} against ${base}`);
  const reset = await call("POST", "/api/controls", { type: "reset" });
  check(reset.status === 200, `reset the room (${reset.status}, ${reset.ms}ms)`);
  etag = null;

  const t0 = Date.now();
  const ack = await call("POST", "/api/signals", { scenario: "group" });
  if (ack.status === 429) console.log(`  The room is paused by a run cap (${ack.json?.reason}): "${ack.json?.text}".`);
  check(ack.status === 202, `POST /api/signals {scenario: group} answered 202 in ${ack.ms}ms`);
  if (ack.status !== 202) return null;
  const { planId, groupId, contexts } = ack.json;
  const pairContexts = Object.values(contexts);
  check(typeof groupId === "string" && pairContexts.length === 2, `group ${groupId} with ${pairContexts.length} pair threads`);

  const arrivals = new Map();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    const snapshot = (await state()) ?? last;
    if (snapshot) {
      for (const message of snapshot.messages.filter((m) => pairContexts.includes(m.contextId))) {
        const key = `${message.contextId}:${message.seq}`;
        if (!arrivals.has(key)) arrivals.set(key, Date.now() - t0);
      }
      last = snapshot;
      if (snapshot.failure) break;
      if (snapshot.plan?.id === planId && (snapshot.plan.state === "awaiting_humans" || snapshot.plan.state === "dropped")) break;
    }
    await sleep(200);
  }
  const agreedMs = Date.now() - t0;
  const messages = (last?.messages ?? []).filter((m) => pairContexts.includes(m.contextId)).sort((a, b) => (arrivals.get(`${a.contextId}:${a.seq}`) ?? 0) - (arrivals.get(`${b.contextId}:${b.seq}`) ?? 0));
  check(last?.plan?.state === "awaiting_humans", `group plan reached awaiting_humans (was ${last?.plan?.state ?? "none"})${last?.failure ? `, failure: ${JSON.stringify(last.failure)}` : ""}`);
  check(pairContexts.every((context) => messages.filter((m) => m.contextId === context).length <= 6), "each pair thread stayed within the 6 message cap");
  const fallbacks = messages.filter((m) => !m.proof).length;
  check(fallbacks === 0, `every message carries model proof${fallbacks > 0 ? ` (${fallbacks} sent by the scripted fallback: the model could not reply)` : ""}`);
  const sendersTo = new Set(messages.filter((m) => m.from === "aaron").map((m) => m.to));
  // /api/state hides rows that name an agent the stage does not know (Pebble) until the group view lifts that
  // guard. Then only Mochi's thread is visible; the plan reaching awaiting_humans on the window all three share
  // is the proof that Pebble's thread agreed too.
  const pebbleHidden = !sendersTo.has("kai") && last?.plan?.state === "awaiting_humans";
  if (pebbleHidden) console.log("  note  Pebble's rows are hidden by the stage's unknown-agent guard; judging by the plan below");
  check(sendersTo.has("lisa") && (sendersTo.has("kai") || pebbleHidden), "Sprout wrote to both Mochi and Pebble");
  check(messages.every((m) => m.from === "aaron" || m.to === "aaron"), "every message is between a friend and Sprout (no friend talks to the other)");
  check(messages.filter((m) => m.from === "aaron" && m.note).length === 0, "the coordinator's notes were dropped in group threads");

  console.log("  ctx   #  from    to      type     arrival  send call  out tok  windows / note");
  for (const m of messages) {
    const arrival = arrivals.get(`${m.contextId}:${m.seq}`) ?? 0;
    console.log(
      `  ${m.contextId.slice(-4)}  ${m.seq}  ${String(nameOf(last, m.from)).padEnd(6)}  ${String(nameOf(last, m.to)).padEnd(6)}  ${m.type.padEnd(7)}  ${seconds(arrival).padStart(7)}  ${seconds(m.proof?.latencyMs ?? 0).padStart(9)}  ${String(m.proof?.outputTokens ?? "").padStart(7)}  ${(m.windows ?? []).length} window(s)${m.note ? ` | "${m.note}"` : ""}${m.proof ? "" : " (fallback, no model proof)"}`,
    );
  }
  console.log(`  three agents ${last?.plan?.state === "awaiting_humans" ? "agreed" : "did not agree"} in ${messages.length} messages at ${seconds(agreedMs)}; window ${last?.plan?.window?.start ?? "none"} to ${last?.plan?.window?.end?.slice(11, 16) ?? ""}`);
  if (last?.plan?.state !== "awaiting_humans") return { messages, agreedMs, last };
  const plan = last.plan;
  check(plan.window && plan.window.start >= "2026-10-27T18:30:00" && plan.window.end <= "2026-10-27T20:00:00-05:00", `the agreed window is inside the only time all three are free (${plan.window?.start} to ${plan.window?.end})`);

  // The three people decide: two on the phones, the third through the member route.
  const [a, b, kai] = await Promise.all([
    call("POST", `/api/plans/${planId}/decision`, { role: "a", choice: "accept" }),
    call("POST", `/api/plans/${planId}/decision`, { role: "b", choice: "accept" }),
    call("POST", `/api/plans/${planId}/member-decision`, { member: "kai", choice: "accept" }),
  ]);
  check(a.status === 200 && b.status === 200 && kai.status === 200, `all three accepted at once (${a.status}/${b.status}/${kai.status})`);
  let now = await state().then((s) => s ?? last);
  check(now.plan?.state === "confirmed", `plan confirmed by all three (${now.plan?.state})`);
  const handoff = await call("POST", `/api/plans/${planId}/draft`, { role: "a", via: "whatsapp" });
  check(handoff.status === 200, `WhatsApp draft opened, hold issued (${handoff.status})`);
  const reminder = await call("POST", "/api/clock", { action: "advance" });
  check(reminder.status === 200 && reminder.json?.data?.plan === "reminded", `clock to the reminder (${reminder.json?.data?.plan ?? reminder.status})`);
  const nextDay = await call("POST", "/api/clock", { action: "advance" });
  check(nextDay.status === 200 && nextDay.json?.data?.plan === "followed_up", `clock to the next day (${nextDay.json?.data?.plan ?? nextDay.status})`);
  etag = null;
  now = await state();
  check(now.plan?.state === "followed_up", `plan followed_up (${now.plan?.state})`);
  // The clock no longer counts a plan as followed through; only a person's "We went!" tap does.
  check(now.followThrough?.events?.length === 0, `the clock alone does not count it (${now.followThrough?.events?.length} event(s))`);
  const went = await call("POST", `/api/plans/${planId}/outcome`, { role: "a", result: "went" });
  check(went.status === 200, `"We went!" tapped (${went.status}, ${went.ms}ms)`);
  etag = null;
  now = await state();
  check(now.followThrough?.events?.length === 1, `Follow-through counts ${now.followThrough?.events?.length} human event(s)`);
  return { messages, agreedMs, last: now };
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
    results.push(await (scenario === "group" ? runGroup : run)(`run ${index}/${runs}`));
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
