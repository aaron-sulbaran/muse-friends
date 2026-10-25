#!/usr/bin/env node
// Runs the real payment flow once against the Capital One Nessie sandbox: two fictional customers with a checking
// account each, a withdrawal from one, the matching deposit into the other, a refund back, and a balance read
// after every write. This is what lib/nessie.ts does in production; if a step fails here, it fails there.
//
//   NESSIE_KEY=... pnpm nessie:check          (or put NESSIE_KEY in .env)
//
// It writes 2 customers, 2 accounts and 3 transactions to the shared sandbox (every team can read them), with
// fictional names only. The key is read from the environment and never printed. Exit code 1 if any check fails.

import { existsSync } from "node:fs";

if (!process.env.NESSIE_KEY && existsSync(".env")) {
  try {
    process.loadEnvFile(".env");
  } catch {
    // no readable .env: fall through to the message below
  }
}
const key = process.env.NESSIE_KEY?.trim();
if (!key) {
  console.log("NESSIE_KEY is not set. Put it in the environment or in .env (never in git), then run this again.");
  process.exit(2);
}
const base = (process.env.NESSIE_BASE_URL ?? "https://api.nessieisreal.com").replace(/\/$/, "");

const failures = [];
function check(ok, label) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures.push(label);
  return ok;
}

async function api(method, path, body) {
  const started = Date.now();
  try {
    const response = await fetch(`${base}${path}?key=${encodeURIComponent(key)}`, {
      method,
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { ok: response.ok, status: response.status, json, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, status: 0, json: null, ms: Date.now() - started, error: error instanceof Error ? error.name : "error" };
  }
}

const idOf = (result) => result.json?.objectCreated?._id;
const today = () => new Date().toISOString().slice(0, 10);
const address = { street_number: "100", street_name: "Demo Way", city: "Austin", state: "TX", zip: "78701" };

async function balanceOf(accountId) {
  const result = await api("GET", `/accounts/${accountId}`);
  return result.ok && typeof result.json?.balance === "number" ? result.json.balance : null;
}

console.log(`\nNESSIE CHECK against ${base}`);
const payer = await api("POST", "/customers", { first_name: "Check", last_name: "Sprout Demo", address });
check(payer.ok && Boolean(idOf(payer)), `create payer customer (${payer.status}, ${payer.ms}ms)`);
const payee = await api("POST", "/customers", { first_name: "Check", last_name: "Mochi Demo", address });
check(payee.ok && Boolean(idOf(payee)), `create payee customer (${payee.status}, ${payee.ms}ms)`);
if (!idOf(payer) || !idOf(payee)) {
  console.log("Customers could not be created; check the key and try again.");
  process.exit(1);
}

const payerAccount = await api("POST", `/customers/${idOf(payer)}/accounts`, { type: "Checking", nickname: "Check payer wallet", rewards: 0, balance: 50 });
const payeeAccount = await api("POST", `/customers/${idOf(payee)}/accounts`, { type: "Checking", nickname: "Check payee wallet", rewards: 0, balance: 50 });
check(payerAccount.ok && payeeAccount.ok, `create the two checking accounts (${payerAccount.status}/${payeeAccount.status})`);
const a = idOf(payerAccount);
const b = idOf(payeeAccount);
if (!a || !b) process.exit(1);

check((await balanceOf(a)) === 50 && (await balanceOf(b)) === 50, "both accounts read back at $50");

const transaction = { medium: "balance", transaction_date: today(), status: "completed", amount: 7, description: "Muse nessie-check payment" };
const withdrawal = await api("POST", `/accounts/${a}/withdrawals`, transaction);
check(withdrawal.ok && Boolean(idOf(withdrawal)), `withdraw $7 from the payer (${withdrawal.status}${withdrawal.ok ? "" : `: ${withdrawal.json?.message ?? ""}`})`);
const afterWithdrawal = await balanceOf(a);
check(afterWithdrawal === 43, `the payer's balance fell to $43 (read back $${afterWithdrawal})`);

const deposit = await api("POST", `/accounts/${b}/deposits`, { ...transaction, description: "Muse nessie-check received" });
check(deposit.ok && Boolean(idOf(deposit)), `deposit $7 into the payee (${deposit.status}${deposit.ok ? "" : `: ${deposit.json?.message ?? ""}`})`);
const afterDeposit = await balanceOf(b);
check(afterDeposit === 57, `the payee's balance rose to $57 (read back $${afterDeposit})`);

const refund = await api("POST", `/accounts/${a}/deposits`, { ...transaction, description: "Muse nessie-check refund" });
check(refund.ok && Boolean(idOf(refund)), `refund $7 to the payer (${refund.status})`);
check((await balanceOf(a)) === 50, "the payer is back at $50");

if (afterWithdrawal !== 43 || afterDeposit !== 57) {
  console.log("\nA write succeeded but the balance did not move as expected. Tell Lane A which status value the sandbox wants (pending, completed, ...): lib/nessie.ts sends status \"completed\".");
}
console.log(failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED:\n  - ${failures.join("\n  - ")}`);
process.exit(failures.length === 0 ? 0 : 1);
