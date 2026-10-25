#!/usr/bin/env node
// One judge alone runs a plan of three, over HTTP against a running app. A model plays Michelle (Mochi's person) and
// Kai (Pebble's person), the same way the stage does when it asks the simulated-friend and simulated-member routes;
// this script asks them the way the page's hooks do. Local or deployed, whatever store the app is configured with.
//
//   pnpm demo:group                                   http://localhost:3001
//   pnpm demo:group -- --base http://localhost:3001 --runs 1
//   pnpm demo:group -- --kind trip                    the long-horizon trip: bounded questions, a cap, an itinerary, a pot
//
// Options: --base URL  --runs N (default 1)  --kind hangout|trip (default hangout)  --keep (do not reset the room at the end)
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
const kind = option("kind", "hangout");
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

// The trip: one judge alone. Sprout asks each Muse one bounded question; a model plays Michelle and Kai; the judge answers
// for themself and joins. Checks that every number has a source and that nothing is called booked.
async function runTrip(label) {
  console.log(`\nDEMO group trip, one judge alone, ${label} against ${base}`);
  const reset = await call("POST", "/api/controls", { type: "reset" });
  check(reset.status === 200, `reset the room (${reset.status}, ${reset.ms}ms)`);
  const alone = await call("POST", "/api/controls", { type: "simulated_friend", on: true });
  check(alone.status === 200, `Michelle and Kai played by a model for the room (${alone.status})`);
  etag = null;

  const t0 = Date.now();
  const ack = await call("POST", "/api/signals", { scenario: "trip" });
  if (ack.status === 429) console.log(`  The room is paused by a run cap (${ack.json?.reason}): "${ack.json?.text}".`);
  check(ack.status === 202, `POST /api/signals {scenario: trip} answered 202 in ${ack.ms}ms`);
  if (ack.status !== 202) return null;
  const { planId } = ack.json;

  const asked = await waitFor("the questions are out", (s) => s.plan?.id === planId && s.messages.some((m) => m.type === "trip_ask"));
  check(asked?.messages.filter((m) => m.type === "trip_ask").length === 2, `Sprout asked both Muses (${asked?.messages.filter((m) => m.type === "trip_ask").length ?? 0} trip_ask)`);

  // The judge answers their own bounded question: yes.
  const mine = await call("POST", "/api/trip/answer", { planId, member: "aaron", answer: "yes" });
  check(mine.status === 200, `the judge answered the bounded question (${mine.status})`);

  const proposed = await waitFor("the proposal", (s) => s.plan?.id === planId && (s.plan.state === "awaiting_humans" || s.plan.state === "dropped"));
  const trip = proposed?.plan?.trip;
  check(proposed?.plan?.state === "awaiting_humans" && trip !== null, `the trip reached awaiting_humans in ${seconds(Date.now() - t0)} (was ${proposed?.plan?.state ?? "none"})`);
  if (!trip) return null;

  console.log(`  answers: ${trip.answers.map((a) => `${trip.people.find((p) => p.member === a.member)?.name} up to $${a.limit} (${a.by})`).join("; ")}`);
  check(trip.answers.length === 3, "all three people answered");
  check(trip.answers.filter((a) => a.by === "person_model").length === 2, `Michelle and Kai were played by a model (${trip.answers.map((a) => a.by).join(", ")})`);
  const lowest = Math.min(...trip.answers.map((a) => a.limit));
  check(trip.cap?.amount === lowest, `the cap is the lowest ceiling, $${trip.cap?.amount} (${trip.cap?.basis})`);
  const itinerary = trip.itinerary;
  check(itinerary?.lines.length === 4, `a four-line itinerary: ${itinerary?.lines.map((l) => l.id).join(", ")} = $${itinerary?.total} per person, composed by ${itinerary?.composedBy}`);
  const flight = itinerary?.lines.find((l) => l.kind === "flight");
  check(flight && flight.cost <= trip.cap?.amount, `the flight is within the flight cap ($${flight?.cost} <= $${trip.cap?.amount})`);
  check(itinerary?.lines.every((l) => l.source.startsWith(trip.seededLabel)), `every line says it is seeded (${trip.seededLabel})`);
  check(trip.unknowns.some((u) => /do not know/i.test(u)), `the coordinator says what it does not know: "${trip.unknowns[0]}"`);
  check(trip.pot && trip.pot.breakdown.every((b) => b.source) && trip.pot.perPerson > 0, `the pot proposes $${trip.pot?.perPerson} each, every breakdown line sourced`);
  const types = proposed.messages.map((m) => m.type);
  check(["trip_ask", "trip_answer", "trip_plan"].every((t) => types.filter((x) => x === t).length === 2), `each member thread carries ask, answer and plan over the protocol (${types.length} messages)`);
  check(proposed.messages.filter((m) => m.type === "trip_plan").every((m) => m.proof), "the coordinator's plan message carries model proof");

  // Michelle and Kai join on their own (a model plays them); the judge confirms their own deposit.
  const others = await waitFor("the others join", (s) => s.plan?.id === planId && s.plan.group?.members.filter((m) => m.id !== "aaron").every((m) => m.decision === "accepted"));
  check(others?.plan?.group?.members.filter((m) => m.id !== "aaron").every((m) => m.decision === "accepted"), `Michelle and Kai joined and funded their deposits (${others?.plan?.group?.members.map((m) => `${m.id}:${m.decision}`).join(" ")})`);
  check(others?.plan?.trip?.pot?.balance === 2 * trip.pot.perPerson, `the pot holds $${others?.plan?.trip?.pot?.balance} after two deposits`);

  const join = await call("POST", "/api/trip/join", { planId, member: "aaron", choice: "in" });
  check(join.status === 200, `the judge confirmed their own deposit (${join.status}, ${seconds(join.ms)})`);
  etag = null;
  const now = await state();
  check(now.plan?.state === "confirmed", `the trip is confirmed by all three (${now.plan?.state})`);
  check(now.plan?.trip?.pot?.balance === 3 * trip.pot.perPerson, `the pot holds $${now.plan?.trip?.pot?.balance}, the target $${trip.pot.target}`);
  const replies = now.messages.filter((m) => m.type === "trip_reply");
  check(replies.length === 2 && replies.every((m) => m.trip?.choice === "in" && m.trip?.ledgerRef), "Mochi and Pebble each told Sprout they are in, with the pot ledger reference");
  console.log(`  total ${seconds(Date.now() - t0)} from the group chat to a confirmed trip; nothing is booked`);
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
    await (kind === "trip" ? runTrip : runHangout)(`run ${index}/${runs}`);
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
