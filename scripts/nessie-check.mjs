#!/usr/bin/env node
// Runs the real payment flow once against the Capital One Nessie sandbox, using the same client the app runs with
// (lib/nessie.ts, NessieWithLedger): two fictional customers with a checking account each, a withdrawal from one,
// the matching deposit into the other, and a refund back. It asserts on what the app relies on:
//
//   the Nessie RECORDS   every write is read back by id (GET /withdrawal/{id}, singular, and GET /deposits/{id}) and must carry
//                        the amount we sent; its status is compared with the one we sent
//   OUR ledger           the balances the app shows (wallet chip, payment cards): 50, 43 and 57, then 50 again
//
// It does NOT assert on the sandbox's own `balance` field, because that field is static: writes land as records
// (201) but the account balance never moves, whatever the status. The script prints what the sandbox says so you can
// see it, and probes status "executed" once on a throwaway write to show whether that changes anything. The app's
// code path stays on "completed" either way.
//
//   NESSIE_KEY=... pnpm nessie:check          (or put NESSIE_KEY in .env)
//
// It writes 2 customers, 2 accounts and about 6 transactions to the shared sandbox (every team can read them),
// with fictional names only. The key is read from the environment and never printed. Exit code 1 if a check fails.

import { existsSync } from "node:fs";
import { NessieHttp, NessieWithLedger, TRANSACTION_STATUS } from "../lib/nessie.ts";

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

const failures = [];
function check(ok, label) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures.push(label);
  return ok;
}
const warn = (label) => console.log(`  WARN  ${label}`);

// Our ledger for this run: the same shape the app keeps on the room, in memory here.
let ledger = {};
const storage = {
  read: async () => ({ ...ledger }),
  write: async (next) => {
    ledger = { ...next };
  },
  exclusive: (work) => work(),
};
const http = new NessieHttp({ key, baseUrl: process.env.NESSIE_BASE_URL, timeoutMs: 10_000 });
const client = new NessieWithLedger(http, storage);

const address = { street_number: "100", street_name: "Demo Way", city: "Austin", state: "TX", zip: "78701" };
const ours = async (id) => (await client.getAccount(id)).data?.balance;
const sandbox = async (id) => (await http.getAccount(id)).data?.balance;

console.log("\nNESSIE CHECK against the sandbox (balances below are OUR ledger; the sandbox's own balance is static)");
const payer = await client.createCustomer({ first_name: "Check", last_name: "Sprout Demo", address });
const payee = await client.createCustomer({ first_name: "Check", last_name: "Mochi Demo", address });
check(payer.error === null && payee.error === null, `create two customers${payer.error ? ` (${payer.error})` : ""}${payee.error ? ` (${payee.error})` : ""}`);
if (payer.error !== null || payee.error !== null) {
  console.log("Customers could not be created; check the key and try again.");
  process.exit(1);
}
const accountA = await client.createAccount(payer.data.id, { nickname: "Check payer wallet", balance: 50 });
const accountB = await client.createAccount(payee.data.id, { nickname: "Check payee wallet", balance: 50 });
check(accountA.error === null && accountB.error === null, `create the two checking accounts${accountA.error ? ` (${accountA.error})` : ""}${accountB.error ? ` (${accountB.error})` : ""}`);
if (accountA.error !== null || accountB.error !== null) process.exit(1);
const a = accountA.data.id;
const b = accountB.data.id;
check((await ours(a)) === 50 && (await ours(b)) === 50, "our ledger starts both wallets at $50");

async function checkRecord(label, read, id, amount) {
  const record = await read(id);
  if (record.error !== null) return check(false, `${label}: read the record back by id (${record.error})`);
  check(record.data.amount === amount, `${label}: the Nessie record holds $${amount} (read back $${record.data.amount})`);
  if (record.data.status === TRANSACTION_STATUS) check(true, `${label}: the Nessie record's status is "${TRANSACTION_STATUS}"`);
  else warn(`${label}: the Nessie record's status reads "${record.data.status}", we sent "${TRANSACTION_STATUS}"`);
  return true;
}

const withdrawal = await client.withdraw(a, { amount: 7, description: "Muse nessie-check payment" });
check(withdrawal.error === null, `withdraw $7 from the payer${withdrawal.error ? ` (${withdrawal.error})` : ""}`);
if (withdrawal.error === null) await checkRecord("withdrawal", (id) => http.getWithdrawal(id), withdrawal.data.id, 7);
check((await ours(a)) === 43, `our ledger: the payer is at $43 (${await ours(a)})`);

const deposit = await client.deposit(b, { amount: 7, description: "Muse nessie-check received" });
check(deposit.error === null, `deposit $7 into the payee${deposit.error ? ` (${deposit.error})` : ""}`);
if (deposit.error === null) await checkRecord("deposit", (id) => http.getDeposit(id), deposit.data.id, 7);
check((await ours(b)) === 57, `our ledger: the payee is at $57 (${await ours(b)})`);

const refund = await client.deposit(a, { amount: 7, description: "Muse nessie-check refund" });
check(refund.error === null, `refund $7 to the payer${refund.error ? ` (${refund.error})` : ""}`);
if (refund.error === null) await checkRecord("refund", (id) => http.getDeposit(id), refund.data.id, 7);
check((await ours(a)) === 50, `our ledger: the payer is back at $50 (${await ours(a)})`);

const overdraft = await client.withdraw(a, { amount: 500, description: "Muse nessie-check overdraft" });
check(overdraft.error === "insufficient funds" && (await ours(a)) === 50, "an overdraft is refused by our ledger before it reaches the sandbox, and moves nothing");

// What the sandbox says about its own balance field: informational, never asserted.
const staticA = await sandbox(a);
const staticB = await sandbox(b);
console.log(`\n  sandbox balance field after the writes: payer $${staticA}, payee $${staticB} (it started at $50 and is static: writes land as records, the field does not follow). Muse keeps the balances.`);

// One probe of the other status value, on a throwaway write that is not part of our ledger.
const probe = await http.withdraw(a, { amount: 1, description: "Muse nessie-check status probe", status: "executed" });
if (probe.error !== null) {
  console.log(`  probe: status "executed" is refused by the sandbox (${probe.error}); the app stays on "${TRANSACTION_STATUS}"`);
} else {
  const record = await http.getWithdrawal(probe.data.id);
  const moved = (await sandbox(a)) !== staticA;
  console.log(`  probe: status "executed" is accepted (the record reads "${record.data?.status ?? "?"}"); the sandbox balance ${moved ? "MOVED" : "did not move"}. The app stays on "${TRANSACTION_STATUS}"`);
  await http.deposit(a, { amount: 1, description: "Muse nessie-check status probe undone" });
}

console.log(failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED:\n  - ${failures.join("\n  - ")}`);
process.exit(failures.length === 0 ? 0 : 1);
