#!/usr/bin/env node
// A payment between the two Muses, driven over HTTP against a running app: get a plan confirmed, let a person turn
// payments on with a cap, ask their Muse to settle up, and watch the model decide the amount, the friend's Muse
// answer, and the balances move. Nothing here names an amount.
//
//   pnpm demo:payments                                  http://localhost:3001
//   pnpm demo:payments -- --base http://localhost:3001 --cap 30 --note "I'll cover Mochi's plate"
//
// Options: --base URL  --cap DOLLARS (default 20)  --note TEXT (what the person says; optional)
//          --payer a|b (default a)  --timeout SECONDS (default 120)  --force (clear a room that is not empty)
// It RESETS the room at the start and at the end, so point it at a room you are happy to clear (never the
// production demo room from an unmerged branch). Exit code 1 if any check fails.

const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (argv[index + 1] ?? fallback);
};
const base = option("base", process.env.DEMO_BASE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const cap = Number(option("cap", "20"));
const note = option("note", undefined);
const payer = option("payer", "a");
const timeoutMs = Number(option("timeout", "120")) * 1000;
const force = argv.includes("--force");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
function check(ok, label) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures.push(label);
  return ok;
}
async function call(method, path, body) {
  const started = Date.now();
  const response = await fetch(`${base}${path}`, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { status: response.status, ms: Date.now() - started, json };
}
const state = async () => (await fetch(`${base}/api/state`, { cache: "no-store" })).json();
async function until(label, predicate) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await state();
    if (predicate(last)) return last;
    await sleep(250);
  }
  check(false, `${label} (timed out)`);
  return last;
}

const initial = await state();
if (!force && (initial.plan || initial.messages.length > 0)) {
  console.log(`The room at ${base} is not empty. Pass --force to clear it and run anyway.`);
  process.exit(2);
}

console.log(`\nPAYMENTS against ${base}`);
check((await call("POST", "/api/controls", { type: "reset" })).status === 200, "reset the room");
let snapshot = await state();
check(Boolean(snapshot.wallets?.aaron && snapshot.wallets?.lisa), `both wallets exist (${snapshot.wallets?.aaron?.balance} and ${snapshot.wallets?.lisa?.balance} dollars)`);
console.log(`  sandbox: connected=${snapshot.sandbox?.connected} "${snapshot.sandbox?.text}"`);
const start = { a: snapshot.wallets.aaron.balance, b: snapshot.wallets.lisa.balance };

const ack = await call("POST", "/api/signals", {});
check(ack.status === 202, `reel sent (${ack.status})`);
const planId = ack.json?.planId;
snapshot = await until("agents agree", (s) => s.plan?.state === "awaiting_humans" || s.plan?.state === "dropped");
check(snapshot.plan?.state === "awaiting_humans", `plan reached awaiting_humans (${snapshot.plan?.state})`);
const [a, b] = await Promise.all([call("POST", `/api/plans/${planId}/decision`, { role: "a", choice: "accept" }), call("POST", `/api/plans/${planId}/decision`, { role: "b", choice: "accept" })]);
check(a.status === 200 && b.status === 200, "both people accepted");

// With payments off (the default) the Muse is not even asked.
const refused = await call("POST", `/api/plans/${planId}/settle`, { role: payer, note });
check(refused.status === 409, `settle refused while payments are off (${refused.status}: ${refused.json?.error?.message})`);

const on = await call("POST", "/api/controls", { type: "payments", side: payer, enabled: true, cap });
check(on.status === 200 && on.json?.data?.payments?.capPerPlan === cap, `payments on with a $${cap} cap per plan`);

const t0 = Date.now();
const settle = await call("POST", `/api/plans/${planId}/settle`, { role: payer, note });
check(settle.status === 202, `settle started (${settle.status}, ${settle.ms}ms)`);
snapshot = await until("a payment is answered", (s) => s.payments?.some((p) => p.status !== "sent"));
const payment = snapshot.payments?.[0];
check(Boolean(payment), "the payer's Muse chose to send money");
if (payment) {
  console.log(`  ${payment.from} -> ${payment.to}: $${payment.amount} "${payment.reason}"${payment.note ? ` note "${payment.note}"` : ""}  status ${payment.status}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  check(payment.amount >= 1 && payment.amount <= cap, `the amount is the model's, inside the cap ($${payment.amount} of $${cap})`);
  check(payment.status === "received" || payment.status === "refunded", `the friend's Muse answered (${payment.status})`);
  check(snapshot.plan?.state === "confirmed", `the plan survived (${snapshot.plan?.state})`);
  const payerNow = payer === "a" ? snapshot.wallets.aaron.balance : snapshot.wallets.lisa.balance;
  const payeeNow = payer === "a" ? snapshot.wallets.lisa.balance : snapshot.wallets.aaron.balance;
  const payerStart = payer === "a" ? start.a : start.b;
  const payeeStart = payer === "a" ? start.b : start.a;
  const moved = payment.status === "received" ? payment.amount : 0;
  check(payerNow === payerStart - moved && payeeNow === payeeStart + moved, `balances moved by $${moved}: payer ${payerStart} to ${payerNow}, friend ${payeeStart} to ${payeeNow}`);
  console.log(`  payment ids: withdrawal ${payment.withdrawalId}, ${payment.status === "received" ? "deposit" : "refund"} ${payment.depositId}`);
}
console.log("  Activity rows:");
for (const row of snapshot.notes.filter((n) => n.kind?.startsWith("payment_"))) console.log(`    ${row.kind}: ${row.text}`);

check((await call("POST", "/api/controls", { type: "reset" })).status === 200, "room reset at the end");
console.log(failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED:\n  - ${failures.join("\n  - ")}`);
process.exit(failures.length === 0 ? 0 : 1);
