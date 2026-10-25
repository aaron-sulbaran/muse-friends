#!/usr/bin/env node
// A payment between the two Muses, driven over HTTP against a running app: get a plan confirmed, let a person turn
// payments on with a cap, ask their Muse to settle up, watch the model prepare a payment with a sourced breakdown
// (nothing moves yet), then confirm it as the person and watch the friend's Muse answer and the balances move.
// Nothing here names an amount.
//
//   pnpm demo:payments                                  http://localhost:3001
//   pnpm demo:payments -- --base http://localhost:3001 --cap 30 --note "I'll cover Mochi's plate"
//
// Options: --base URL  --cap DOLLARS (default 20)  --note TEXT (what the person says; optional)
//          --payer a|b (default a)  --timeout SECONDS (default 120)  --force (clear a room that is not empty)
//          --decline (the person declines the prepared payment instead of confirming it)
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
const declineInstead = argv.includes("--decline");

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

// D28: the Muse only PREPARES. Nothing moves until the person confirms (or declines with --decline).
snapshot = await until("a payment is prepared", (s) => s.payments?.some((p) => p.status === "proposed"));
const proposed = snapshot.payments?.find((p) => p.status === "proposed");
check(Boolean(proposed), "the payer's Muse prepared a payment");
const walletOf = (s, who) => (who === "a" ? s.wallets.aaron.balance : s.wallets.lisa.balance);
if (proposed) {
  console.log(`  ${proposed.from} -> ${proposed.to}: $${proposed.amount} "${proposed.reason}"  prepared (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  check(proposed.amount >= 1 && proposed.amount <= cap, `the amount is the model's, inside the cap ($${proposed.amount} of $${cap})`);
  const lines = proposed.breakdown ?? [];
  check(lines.length > 0 && lines.reduce((sum, line) => sum + line.amount, 0) === proposed.amount, `the breakdown adds up to $${proposed.amount} (${lines.map((line) => `${line.label} $${line.amount} [${line.sourceKind}]`).join("; ")})`);
  check(lines.every((line) => line.sourceKind === "tool" || line.sourceKind === "note" || line.sourceKind === "estimate"), "every line names where its number came from");
  if (proposed.explanation) console.log(`  explanation: ${proposed.explanation}`);
  check(Boolean(proposed.confirmUrl) && Boolean(proposed.declineUrl), "the snapshot hands the UI confirm and decline URLs");
  check(walletOf(snapshot, "a") === start.a && walletOf(snapshot, "b") === start.b, "nothing moved while the payment was only prepared");

  const decision = declineInstead ? proposed.declineUrl : proposed.confirmUrl;
  const answer = await call("POST", decision, { role: payer });
  check(answer.status === 200, `${declineInstead ? "decline" : "confirm"} accepted (${answer.status}${answer.json?.error ? `: ${answer.json.error.message}` : ""})`);
  const again = await call("POST", decision, { role: payer });
  check(again.status === 200 && again.json?.data?.already === true, "a second tap is idempotent (already)");

  if (declineInstead) {
    snapshot = await until("the payment is declined", (s) => s.payments?.some((p) => p.id === proposed.id && p.status === "declined"));
    check(walletOf(snapshot, "a") === start.a && walletOf(snapshot, "b") === start.b, "a decline moved nothing");
  } else {
    snapshot = await until("the friend's Muse answers", (s) => s.payments?.some((p) => p.id === proposed.id && (p.status === "received" || p.status === "refunded" || p.status === "failed")));
    const payment = snapshot.payments.find((p) => p.id === proposed.id);
    check(payment.status === "received" || payment.status === "refunded", `the friend's Muse answered (${payment.status})`);
    check(snapshot.plan?.state === "confirmed", `the plan survived (${snapshot.plan?.state})`);
    const moved = payment.status === "received" ? payment.amount : 0;
    const payerStart = payer === "a" ? start.a : start.b;
    const payeeStart = payer === "a" ? start.b : start.a;
    const payerNow = walletOf(snapshot, payer);
    const payeeNow = walletOf(snapshot, payer === "a" ? "b" : "a");
    check(payerNow === payerStart - moved && payeeNow === payeeStart + moved, `balances moved by $${moved}: payer ${payerStart} to ${payerNow}, friend ${payeeStart} to ${payeeNow}`);
    console.log(`  payment ids: withdrawal ${payment.withdrawalId}, ${payment.status === "received" ? "deposit" : "refund"} ${payment.depositId}`);
  }
}
console.log("  Activity rows:");
for (const row of snapshot.notes.filter((n) => n.kind?.startsWith("payment_"))) console.log(`    ${row.kind}: ${row.text}`);

check((await call("POST", "/api/controls", { type: "reset" })).status === 200, "room reset at the end");
console.log(failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED:\n  - ${failures.join("\n  - ")}`);
process.exit(failures.length === 0 ? 0 : 1);
