import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDemo, setPayments } from "@/lib/agent/controls";
import { injectSignal, runInboxTurn } from "@/lib/agent/runtime";
import { runPaymentTurn, runSettleTurn } from "@/lib/agent/payment-runtime";
import { acceptPayment, declinePayment, getWallet, sendMoney, type PaymentContext } from "@/lib/agent/payments";
import { paymentsFrom, sentOnPlan } from "@/lib/agent/payment-rules";
import { agentToken, localDeliver, receiveMessage } from "@/lib/agent/wire";
import { ensureWallets, refreshWallet, walletOf } from "@/lib/agent/wallets";
import { NessieHttp, NessieWithLedger } from "@/lib/nessie";
import { AgentMessage, SendToFriendArgs, type AgentId, type Plan, type SharePolicy } from "@/lib/protocol";
import { rawShawarmaSignal } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";

// Friend-to-friend payments, on the local ledger (no NESSIE_KEY): policy scope and cap, the tools, both ends
// validating, the balances moving, refunds, and a ledger error that never drops the plan.

const scheduled: Array<() => unknown> = [];
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (callback: () => unknown) => void scheduled.push(callback) }));

let store: JsonStore;
let plan: Plan;
let clock: number;
const wallNow = () => (clock += 1000);

const policy = (owner: AgentId, cap: number, enabled = true): SharePolicy => ({
  owner,
  friend: owner === "aaron" ? "lisa" : "aaron",
  tier: "close",
  categories: {},
  payments: { enabled, capPerPlan: cap },
});

async function confirmedPlan(state: Plan["state"] = "confirmed"): Promise<Plan> {
  const { planId } = await injectSignal(store, { ...rawShawarmaSignal(), id: "sig_pay" }, wallNow);
  const base = (await store.getPlan(planId))!;
  const next: Plan = {
    ...base,
    state,
    activity: { kind: "food", title: "Shawarma Point", place: "E 6th St" },
    window: { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" },
  };
  await store.putPlan(next);
  return next;
}

const ctxFor = (agent: AgentId, extra: Partial<PaymentContext> = {}): PaymentContext => ({ store, agent, planId: plan.id, wallNow, deliver: localDeliver(store, agent), ...extra });
const balances = async () => ({ aaron: (await walletOf(store, "aaron"))!.balance, lisa: (await walletOf(store, "lisa"))!.balance });
const payContext = async () => (await store.listThreads()).find((thread) => thread.contextId.startsWith("pay_"))!.contextId;

beforeEach(async () => {
  clock = Date.parse("2026-10-25T20:00:00-05:00");
  store = new JsonStore(null);
  delete process.env.NESSIE_KEY;
  delete process.env.PAYMENTS;
  await ensureWallets(store, wallNow);
  plan = await confirmedPlan();
  await store.putPolicy(policy("aaron", 20));
  await store.putPolicy(policy("lisa", 0, false));
  scheduled.length = 0;
});
afterEach(() => {
  removeFakeModel();
  vi.unstubAllGlobals();
  delete process.env.NESSIE_KEY;
  delete process.env.PAYMENTS;
});

describe("wallets", () => {
  it("gives each seat a checking account with the seeded balance, on the local ledger when there is no key", async () => {
    const [sprout, mochi] = [await walletOf(store, "aaron"), await walletOf(store, "lisa")];
    expect(sprout).toMatchObject({ owner: "aaron", nickname: "Sprout's wallet", balance: 120, startingBalance: 120, source: "local" });
    expect(mochi).toMatchObject({ owner: "lisa", nickname: "Mochi's wallet", balance: 80, startingBalance: 80, source: "local" });
    expect(sprout!.accountId).not.toBe(mochi!.accountId);
  });

  it("puts the same accounts back to their starting balance on Reset instead of making new ones", async () => {
    const before = (await walletOf(store, "aaron"))!;
    await sendMoney(ctxFor("aaron"), { to: "lisa", amount: 12, reason: "covering your plate" });
    expect((await balances()).aaron).toBe(108);
    await resetDemo(store, {}, { wallNow });
    const after = (await walletOf(store, "aaron"))!;
    expect(after).toMatchObject({ accountId: before.accountId, customerId: before.customerId, balance: 120 });
    expect((await walletOf(store, "lisa"))!.balance).toBe(80);
  });

  it("shows a visible 'sandbox not connected' flag in the snapshot, and the wallets and scope per side", async () => {
    const ui = toUiSnapshot(await store.snapshot(), { mode: "live" });
    expect(ui.sandbox).toEqual({ enabled: true, connected: false, text: "Sandbox not connected, using a local ledger" });
    expect(ui.wallets.aaron).toMatchObject({ balance: 120, nickname: "Sprout's wallet", source: "local" });
    expect(ui.wallets.lisa).toMatchObject({ balance: 80 });
    expect(ui.paymentsScope).toEqual({ aaron: { enabled: true, cap: 20 }, lisa: { enabled: false, cap: 0 } });
    expect(ui.payments).toEqual([]);
  });

  it("is off entirely with PAYMENTS=off: no wallets, and the tools say so", async () => {
    process.env.PAYMENTS = "off";
    const fresh = new JsonStore(null);
    await resetDemo(fresh, {}, { wallNow });
    expect((await fresh.getRoom()).wallets).toBeUndefined();
    expect(await sendMoney({ store: fresh, agent: "aaron", planId: "x" }, { to: "lisa", amount: 5, reason: "x" })).toEqual({ error: "Payments are switched off" });
  });
});

describe("the share policy's payments scope", () => {
  it("refuses when the person has not turned payments on, and nothing moves", async () => {
    await store.putPolicy(policy("aaron", 20, false));
    const result = await sendMoney(ctxFor("aaron"), { to: "lisa", amount: 5, reason: "pizza" });
    expect(result).toMatchObject({ error: expect.stringContaining("Payments are off") });
    expect(await balances()).toEqual({ aaron: 120, lisa: 80 });
    expect(await store.listMessages()).toHaveLength(0);
  });

  it("refuses above the cap and counts what is already sent for the plan", async () => {
    expect(await sendMoney(ctxFor("aaron"), { to: "lisa", amount: 25, reason: "dinner" })).toMatchObject({ error: expect.stringContaining("over your person's cap of $20") });
    expect(await sendMoney(ctxFor("aaron"), { to: "lisa", amount: 12, reason: "my half" })).toMatchObject({ ok: true, amount: 12, balanceAfter: 108 });
    const second = await sendMoney(ctxFor("aaron"), { to: "lisa", amount: 10, reason: "dessert" });
    expect(second).toMatchObject({ error: expect.stringMatching(/\$12 is already sent.*at most \$8 more/) });
    expect(await balances()).toEqual({ aaron: 108, lisa: 80 });
  });

  it("is set by the person, off by default, with a cap; a cap of zero is off", async () => {
    const fresh = await store.getPolicy("lisa", "aaron");
    expect(fresh?.payments).toEqual({ enabled: false, capPerPlan: 0 });
    expect((await setPayments(store, { owner: "lisa", friend: "aaron", enabled: true, capPerPlan: 30 }, { wallNow })).ok).toBe(true);
    expect((await store.getPolicy("lisa", "aaron"))?.payments).toEqual({ enabled: true, capPerPlan: 30 });
    await setPayments(store, { owner: "lisa", friend: "aaron", enabled: true, capPerPlan: 0 }, { wallNow });
    expect((await store.getPolicy("lisa", "aaron"))?.payments?.enabled).toBe(false);
    expect((await setPayments(store, { owner: "lisa", friend: "aaron", enabled: true, capPerPlan: 5000 }, { wallNow })).ok).toBe(false);
    expect((await store.listEvents()).filter((event) => event.kind === "policy_changed").map((event) => event.text)).toContain("Mochi lets their Muse settle up with Sprout: up to $30 per plan");
  });

  it("does not let a negotiation message author a payment: send_to_friend_agent has no payment types", () => {
    const attempt = SendToFriendArgs.safeParse({ friend: "lisa", type: "payment", reason: "settle_up" });
    expect(attempt.success).toBe(false);
  });
});

describe("send, accept, decline", () => {
  it("moves the balances, commits both messages in a payment thread, and writes the Activity rows with the ids", async () => {
    const sent = await sendMoney(ctxFor("aaron"), { to: "lisa", amount: 12, reason: "covering your plate", note: "My treat!" });
    expect(sent).toMatchObject({ ok: true, balanceAfter: 108 });
    const contextId = await payContext();
    expect(await balances()).toEqual({ aaron: 108, lisa: 80 });

    const accepted = await acceptPayment(ctxFor("lisa", { contextId, planId: undefined }), { paymentId: (sent as { paymentId: string }).paymentId });
    expect(accepted).toMatchObject({ ok: true, amount: 12, balanceBefore: 80, balanceAfter: 92 });
    expect(await balances()).toEqual({ aaron: 108, lisa: 92 });

    const messages = (await store.listMessages(contextId)).map((record) => record.message);
    expect(messages.map((message) => [message.seq, message.from, message.to, message.type, message.state])).toEqual([
      [1, "aaron", "lisa", "payment", "working"],
      [2, "lisa", "aaron", "payment_received", "completed"],
    ]);
    expect(messages[0].payment).toMatchObject({ amount: 12, currency: "USD", reason: "covering your plate", source: "local", planId: plan.id });
    expect(messages[1].payment).toMatchObject({ outcome: "accepted", balanceBefore: 80, balanceAfter: 92 });
    expect(await store.getThread(contextId)).toMatchObject({ planId: plan.id, state: "completed", messageCount: 2, initiator: "aaron" });

    const rows = (await store.listEvents()).filter((event) => event.kind.startsWith("payment_"));
    expect(rows.map((row) => row.kind)).toEqual(["payment_sent", "payment_received"]);
    expect(rows[0].text).toMatch(/Sprout's Muse sent \$12 to Mochi's Muse: covering your plate \(local ledger, withdrawal wd_local_/);
    expect(rows[1].text).toMatch(/Mochi's Muse accepted \$12 from Sprout: balance \$80 to \$92 \(local ledger, deposit dp_local_/);
    // A payment never touches the plan.
    expect(await store.getPlan(plan.id)).toMatchObject({ state: "confirmed" });
  });

  it("sends a declined payment straight back as a labeled refund and tells the payer", async () => {
    const sent = (await sendMoney(ctxFor("aaron"), { to: "lisa", amount: 15, reason: "ticket" })) as { paymentId: string };
    const contextId = await payContext();
    expect(await balances()).toEqual({ aaron: 105, lisa: 80 });

    const declined = await declinePayment(ctxFor("lisa", { contextId, planId: undefined }), { paymentId: sent.paymentId, reason: "Too much for a snack, thanks" });
    expect(declined).toMatchObject({ ok: true, amount: 15, refundId: expect.stringMatching(/^dp_local_/) });
    expect(await balances()).toEqual({ aaron: 120, lisa: 80 });

    const answer = (await store.listMessages(contextId)).at(-1)!.message;
    expect(answer).toMatchObject({ type: "payment_received", note: "Too much for a snack, thanks", payment: { outcome: "declined", depositId: expect.stringMatching(/^dp_local_/) } });
    const row = (await store.listEvents()).find((event) => event.kind === "payment_declined")!;
    expect(row.text).toMatch(/declined \$15 from Sprout: Too much for a snack, thanks\. Refunded to Sprout \(local ledger, refund dp_local_/);
    // A refunded payment frees the cap again.
    expect(await sentOnPlan(store, plan.id, "aaron")).toBe(0);
    expect(paymentsFrom(await store.listMessages()).map((payment) => payment.status)).toEqual(["refunded"]);
  });

  it("answers a payment only once, and only the person it was sent to", async () => {
    const sent = (await sendMoney(ctxFor("aaron"), { to: "lisa", amount: 5, reason: "coffee" })) as { paymentId: string };
    const contextId = await payContext();
    expect(await acceptPayment(ctxFor("aaron", { contextId }), { paymentId: sent.paymentId })).toMatchObject({ error: "This payment is not addressed to you." });
    expect(await acceptPayment(ctxFor("lisa", { contextId }), { paymentId: sent.paymentId })).toMatchObject({ ok: true });
    expect(await acceptPayment(ctxFor("lisa", { contextId }), { paymentId: sent.paymentId })).toMatchObject({ error: "This payment has already been answered." });
    expect(await declinePayment(ctxFor("lisa", { contextId }), { paymentId: sent.paymentId })).toMatchObject({ error: "This payment has already been answered." });
    expect(await acceptPayment(ctxFor("lisa", { contextId }), { paymentId: "pay_nope" })).toMatchObject({ error: expect.stringContaining("There is no payment") });
    expect(await balances()).toEqual({ aaron: 115, lisa: 85 });
  });

  it("refuses more than the balance, an unknown friend, and a plan that is not confirmed", async () => {
    await store.putPolicy(policy("aaron", 500));
    expect(await sendMoney(ctxFor("aaron"), { to: "lisa", amount: 130, reason: "everything" })).toMatchObject({ error: "Your balance is $120, which is less than $130." });
    expect(await sendMoney(ctxFor("aaron"), { to: "somebody", amount: 5, reason: "x" })).toMatchObject({ error: expect.stringContaining('(to: "lisa")') });
    expect(await sendMoney(ctxFor("aaron"), { to: "Mochi", amount: 0, reason: "x" })).toMatchObject({ error: expect.stringContaining("Invalid arguments") });
    expect(await sendMoney(ctxFor("aaron"), { to: "Mochi", amount: 5.5, reason: "x" })).toMatchObject({ error: expect.stringContaining("Invalid arguments") });
    await store.putPlan({ ...plan, state: "awaiting_humans" });
    expect(await sendMoney(ctxFor("aaron"), { to: "lisa", amount: 5, reason: "x" })).toMatchObject({ error: expect.stringContaining("only once the plan is confirmed") });
    expect(await balances()).toEqual({ aaron: 120, lisa: 80 });
  });

  it("keeps private details out of the reason, like a note", async () => {
    await sendMoney(ctxFor("aaron"), { to: "lisa", amount: 8, reason: "for after my Interview, Northwind Labs" });
    const [payment] = await store.listMessages();
    expect(payment.message.payment?.reason).toBe("Settling up");
    expect(JSON.stringify(payment.message)).not.toMatch(/Northwind/i);
    expect(payment.stamp.removed).toContain("events");
  });

  it("reads the wallet and the cap for the model", async () => {
    await sendMoney(ctxFor("aaron"), { to: "lisa", amount: 7, reason: "tacos" });
    expect(await getWallet(ctxFor("aaron"))).toMatchObject({ ok: true, balance: 113, capPerPlan: 20, sentOnThisPlan: 7, capLeft: 13, sandbox: expect.stringContaining("sandbox not connected") });
  });
});

describe("the agents decide: nothing about the amount is scripted", () => {
  const run = async (script: Parameters<typeof installFakeModel>[0], note?: string) => {
    installFakeModel(script);
    return runSettleTurn({ store, agent: "aaron", planId: plan.id, note, wallNow, deliver: localDeliver(store, "aaron") });
  };

  it("lets the payer's model pick the amount and the reason, and the friend's model accept through the inbox", async () => {
    await run([
      { calls: [{ name: "get_wallet", args: {} }] },
      { calls: [{ name: "send_money", args: { to: "lisa", amount: 9, reason: "your half of the shawarma" } }] },
      { text: "Sent." },
    ]);
    expect(await balances()).toEqual({ aaron: 111, lisa: 80 });

    installFakeModel([{ calls: [{ name: "get_wallet", args: {} }] }, { calls: [{ name: "accept_payment", args: { paymentId: paymentsFrom(await store.listMessages())[0].paymentId } }] }]);
    const turn = await runInboxTurn({ store, agent: "lisa", contextId: await payContext(), wallNow, deliver: localDeliver(store, "lisa") });
    expect(turn.status).toBe("completed");
    expect(await balances()).toEqual({ aaron: 111, lisa: 89 });
    expect(toUiSnapshot(await store.snapshot(), { mode: "live" }).payments).toMatchObject([{ from: "aaron", to: "lisa", amount: 9, reason: "your half of the shawarma", status: "received", balanceBefore: 80, balanceAfter: 89 }]);

    // Each payment message carries the tools the agent called on the way to it, one line each, no balance.
    const [payment, receipt] = await store.listMessages();
    expect(payment.proof?.toolCalls).toEqual([
      { name: "get_wallet", args: "", result: "balance read" },
      { name: "send_money", args: "$9 to lisa", result: "withdrew $9, payment sent" },
    ]);
    expect(receipt.proof?.toolCalls).toEqual([
      { name: "get_wallet", args: "", result: "balance read" },
      { name: "accept_payment", args: payment.message.payment!.paymentId, result: "deposited $9" },
    ]);
    expect(JSON.stringify([payment.proof, receipt.proof])).not.toMatch(/\b(120|111|89|80)\b/);
  });

  it("covers a friend's ticket just as well: a different amount, a different reason, the same code", async () => {
    await store.putPolicy(policy("aaron", 60));
    await run([{ calls: [{ name: "send_money", args: { to: "Mochi", amount: 45, reason: "covering your concert ticket" } }] }, { text: "Done." }], "I'll cover Mochi's ticket");
    expect((await store.listMessages())[0].message.payment).toMatchObject({ amount: 45, reason: "covering your concert ticket" });
    expect(await balances()).toEqual({ aaron: 75, lisa: 80 });
  });

  it("gives the model the plan, the cap and the person's note as data, and no amount", async () => {
    const model = installFakeModel([{ text: "Nothing to settle." }]);
    await runSettleTurn({ store, agent: "aaron", planId: plan.id, note: "split it down the middle", wallNow });
    const input = JSON.stringify(model.calls[0].input);
    expect(input).toContain("Shawarma Point");
    expect(input).toContain("up to $20 per plan");
    expect(input).toContain("split it down the middle");
    expect(input).not.toMatch(/send_money.*amount.*\d/);
    expect((model.calls[0].tools as Array<{ name: string }>).map((tool) => tool.name)).toEqual(["get_wallet", "send_money"]);
  });

  it("lets the model decide not to pay", async () => {
    await run([{ text: "No money needs to move for this plan." }]);
    expect(await store.listMessages()).toHaveLength(0);
    expect(await balances()).toEqual({ aaron: 120, lisa: 80 });
  });

  it("refuses to start a settle turn that could never pay, without a model call", async () => {
    const model = installFakeModel([]);
    await store.putPolicy(policy("aaron", 20, false));
    expect(await runSettleTurn({ store, agent: "aaron", planId: plan.id, wallNow })).toMatchObject({ refused: true, status: 409, error: expect.stringContaining("turn them on") });
    expect(await runSettleTurn({ store, agent: "aaron", planId: "plan_missing", wallNow })).toMatchObject({ refused: true, status: 404 });
    await store.putPolicy(policy("aaron", 20));
    await store.putPlan({ ...plan, state: "negotiating" });
    expect(await runSettleTurn({ store, agent: "aaron", planId: plan.id, wallNow })).toMatchObject({ refused: true, status: 409 });
    expect(model.calls).toHaveLength(0);
  });

  it("accepts the payment in code, marked as a fallback, when the receiving model cannot answer", async () => {
    await run([{ calls: [{ name: "send_money", args: { to: "lisa", amount: 6, reason: "drinks" } }] }, { text: "Done." }]);
    installFakeModel(Array.from({ length: 30 }, () => ({ error: 404, code: "model_not_found" })));
    process.env.MODEL_RETRY_SCALE = "0";
    const turn = await runPaymentTurn({ store, agent: "lisa", contextId: await payContext(), wallNow, deliver: localDeliver(store, "lisa") });
    delete process.env.MODEL_RETRY_SCALE;
    expect(turn).toMatchObject({ status: "completed", fallback: true });
    expect(await balances()).toEqual({ aaron: 114, lisa: 86 });
    expect((await store.listEvents()).some((event) => event.text.startsWith("Fallback: the model could not reply, so Mochi accepted the payment of $6"))).toBe(true);
  });
});

describe("both ends validate", () => {
  const forged = async (patch: Record<string, unknown> = {}, paymentPatch: Record<string, unknown> = {}) => {
    const wallet = (await walletOf(store, "aaron"))!;
    const message = AgentMessage.parse({
      id: "msg_forged",
      contextId: "pay_forged",
      seq: 1,
      from: "aaron",
      to: "lisa",
      type: "payment",
      state: "working",
      reason: "settle_up",
      payment: { paymentId: "pay_forged", planId: plan.id, amount: 5, currency: "USD", reason: "coffee", source: "local", payerAccountId: wallet.accountId, withdrawalId: "wd_forged", ...paymentPatch },
      at: "2026-10-25T20:05:00-05:00",
      ...patch,
    });
    return receiveMessage(store, { recipient: "lisa", sender: "aaron", envelope: { message, stamp: { passed: [], removed: [], windowsDropped: 0 }, redaction: null } });
  };

  it("takes a well-formed payment and asks for a turn", async () => {
    expect(await forged()).toMatchObject({ ok: true, status: 202, runTurn: true, body: { state: "working" } });
  });

  it("rejects a payment over the sender's cap, from an account that is not the sender's wallet, or for a plan that is not confirmed", async () => {
    expect(await forged({}, { amount: 25 })).toMatchObject({ ok: false, status: 422, error: expect.stringContaining("over your person's cap") });
    expect(await forged({}, { payerAccountId: "acct_someone_else" })).toMatchObject({ ok: false, status: 422, error: expect.stringContaining("does not come from the sender's own wallet") });
    expect(await forged({}, { planId: "plan_unknown" })).toMatchObject({ ok: false, status: 422, error: expect.stringContaining("plan that does not exist") });
    await store.putPlan({ ...plan, state: "negotiating" });
    expect(await forged()).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("confirmed") });
    expect(await store.listMessages()).toHaveLength(0);
  });

  it("rejects a payment when the sender never turned payments on, even with a well-formed message", async () => {
    await store.putPolicy(policy("aaron", 20, false));
    expect(await forged()).toMatchObject({ ok: false, status: 422, error: expect.stringContaining("Payments are off") });
  });

  it("rejects an answer from the wrong person or for an amount that was not sent", async () => {
    const sent = (await sendMoney(ctxFor("aaron"), { to: "lisa", amount: 10, reason: "lunch" })) as { paymentId: string };
    const contextId = await payContext();
    const wallet = (await walletOf(store, "lisa"))!;
    const payerAccountId = (await walletOf(store, "aaron"))!.accountId;
    const answer = (payment: Record<string, unknown>, patch: Record<string, unknown> = {}) =>
      receiveMessage(store, {
        recipient: "aaron",
        sender: "lisa",
        envelope: {
          message: AgentMessage.parse({
            id: "msg_answer", contextId, seq: 2, from: "lisa", to: "aaron", type: "payment_received", state: "completed", reason: "settle_up", at: "2026-10-25T20:06:00-05:00",
            payment: { paymentId: sent.paymentId, planId: plan.id, amount: 10, currency: "USD", reason: "lunch", source: "local", payerAccountId, outcome: "accepted", payeeAccountId: wallet.accountId, depositId: "dp_x", balanceBefore: 80, balanceAfter: 90, ...payment },
            ...patch,
          }),
          stamp: { passed: [], removed: [], windowsDropped: 0 },
          redaction: null,
        },
      });
    expect(await answer({ amount: 99 })).toMatchObject({ ok: false, status: 422, error: expect.stringContaining("different amount") });
    expect(await answer({ payeeAccountId: "acct_elsewhere" })).toMatchObject({ ok: false, status: 422, error: expect.stringContaining("receiver's own wallet") });
    expect(await answer({})).toMatchObject({ ok: true, body: { state: "completed" }, runTurn: false });
  });

  it("goes through the real inbox route with the sender's bearer token", async () => {
    const wallet = (await walletOf(store, "aaron"))!;
    (globalThis as { __museStore?: unknown }).__museStore = Promise.resolve(store);
    const { POST } = await import("@/app/api/agents/[id]/inbox/route");
    const message = AgentMessage.parse({
      id: "msg_http", contextId: "pay_http", seq: 1, from: "aaron", to: "lisa", type: "payment", state: "working", reason: "settle_up", at: "2026-10-25T20:05:00-05:00",
      payment: { paymentId: "pay_http", planId: plan.id, amount: 4, currency: "USD", reason: "boba", source: "local", payerAccountId: wallet.accountId, withdrawalId: "wd_http" },
    });
    const response = await POST(
      new Request("http://localhost:3001/api/agents/lisa/inbox", {
        method: "POST",
        headers: { authorization: `Bearer ${agentToken("aaron")}`, "content-type": "application/json" },
        body: JSON.stringify({ message, stamp: { passed: [], removed: [], windowsDropped: 0 }, redaction: null }),
      }),
      { params: Promise.resolve({ id: "lisa" }) },
    );
    expect(response.status).toBe(202);
    expect(scheduled).toHaveLength(1);
    (globalThis as { __museStore?: unknown }).__museStore = undefined;
  });
});

describe("when the ledger fails, the plan survives", () => {
  it("reports a sandbox error honestly, moves nothing, and leaves the plan alone", async () => {
    process.env.NESSIE_KEY = "test-key-never-printed";
    const wallet = (await walletOf(store, "aaron"))!;
    await store.putRoom({ ...(await store.getRoom()), wallets: { ...(await store.getRoom()).wallets, aaron: { ...wallet, source: "nessie" } } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ message: "boom" }), { status: 500 })));

    const result = await sendMoney(ctxFor("aaron"), { to: "lisa", amount: 5, reason: "snack" });
    expect(result).toMatchObject({ error: expect.stringMatching(/^Payment failed, sandbox error: sandbox error 500: boom\. Nothing was sent\.$/) });
    expect(JSON.stringify(result)).not.toContain("test-key-never-printed");
    expect(await store.listMessages()).toHaveLength(0);
    const rows = (await store.listEvents()).filter((event) => event.kind === "payment_failed");
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toContain("Payment failed, sandbox error");
    expect(rows[0].text).not.toContain("test-key-never-printed");
    expect(await store.getPlan(plan.id)).toMatchObject({ state: "confirmed" });
  });

  it("gives the money back when the message to the friend cannot be delivered", async () => {
    const result = await sendMoney(ctxFor("aaron", { deliver: async () => ({ ok: false, status: 503, error: "inbox down" }) }), { to: "lisa", amount: 10, reason: "dinner" });
    expect(result).toMatchObject({ error: expect.stringContaining("The money was returned to your wallet") });
    expect(await balances()).toEqual({ aaron: 120, lisa: 80 });
    expect((await store.listEvents()).some((event) => event.kind === "payment_failed" && /Refunded/.test(event.text))).toBe(true);
  });

  it("does not fail a Reset when the sandbox is down", async () => {
    process.env.NESSIE_KEY = "test-key-never-printed";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    const fresh = new JsonStore(null);
    await expect(resetDemo(fresh, {}, { wallNow })).resolves.toMatchObject({ resetCount: expect.any(Number) });
    expect((await fresh.listEvents()).filter((event) => event.kind === "payment_failed").length).toBeGreaterThan(0);
    expect((await fresh.getRoom()).wallets).toBeUndefined();
  });
});

describe("the Nessie client", () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const stub = (responses: Array<Response>) => {
    calls.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return responses.shift() ?? new Response("{}", { status: 500 });
    }));
  };
  const json = (body: unknown, status = 201) => new Response(JSON.stringify(body), { status });

  it("sends the key as ?key=, validates the shapes, and creates a customer, an account, a withdrawal and a deposit", async () => {
    const client = new NessieHttp({ key: "abc123" });
    stub([
      json({ objectCreated: { _id: "cust1" } }),
      json({ objectCreated: { _id: "acct1" } }),
      json({ _id: "acct1", balance: 100, nickname: "Sprout's wallet" }, 200),
      json({ objectCreated: { _id: "wd1" } }),
      json({ objectCreated: { _id: "dp1" } }),
      json({ _id: "acct1", balance: 91 }, 200),
    ]);
    expect(await client.createCustomer({ first_name: "Sprout", last_name: "Muse Demo", address: { street_number: "100", street_name: "Demo Way", city: "Austin", state: "TX", zip: "78701" } })).toEqual({ data: { id: "cust1" }, error: null });
    expect(await client.createAccount("cust1", { nickname: "Sprout's wallet", balance: 100 })).toEqual({ data: { id: "acct1", balance: 100, nickname: "Sprout's wallet" }, error: null });
    expect(await client.withdraw("acct1", { amount: 9, description: "Muse pay_1: tacos" })).toEqual({ data: { id: "wd1" }, error: null });
    expect(await client.deposit("acct1", { amount: 1, description: "x" })).toEqual({ data: { id: "dp1" }, error: null });
    expect(await client.getAccount("acct1")).toEqual({ data: { id: "acct1", balance: 91, nickname: "" }, error: null });
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.nessieisreal.com/customers?key=abc123",
      "https://api.nessieisreal.com/customers/cust1/accounts?key=abc123",
      "https://api.nessieisreal.com/accounts/acct1?key=abc123",
      "https://api.nessieisreal.com/accounts/acct1/withdrawals?key=abc123",
      "https://api.nessieisreal.com/accounts/acct1/deposits?key=abc123",
      "https://api.nessieisreal.com/accounts/acct1?key=abc123",
    ]);
    expect(JSON.parse(String(calls[3].init.body))).toMatchObject({ medium: "balance", amount: 9, description: "Muse pay_1: tacos" });
  });

  it("never lets the key into an error, and rejects anything that is not whole dollars", async () => {
    const client = new NessieHttp({ key: "abc123" });
    stub([new Response(JSON.stringify({ message: "Invalid API key" }), { status: 401 })]);
    const unauthorized = await client.deposit("acct1", { amount: 5, description: "x" });
    expect(unauthorized).toEqual({ data: null, error: "sandbox error 401: Invalid API key" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed https://api.nessieisreal.com/x?key=abc123"); }));
    const unreachable = await client.getAccount("acct1");
    expect(unreachable.error).toBe("the sandbox could not be reached");
    expect(JSON.stringify(unreachable)).not.toContain("abc123");
    expect(await client.deposit("acct1", { amount: 5.5, description: "x" })).toEqual({ data: null, error: "amount must be a whole number of dollars" });
    stub([json({ unexpected: true })]);
    expect((await client.getAccount("acct1")).error).toBe("the sandbox answered in a shape we do not know");
  });

  it("makes wallets on the real sandbox when the key is set, keeping the balances in our own ledger", async () => {
    process.env.NESSIE_KEY = "abc123";
    const fresh = new JsonStore(null);
    stub([json({ objectCreated: { _id: "c1" } }), json({ objectCreated: { _id: "a1" } }), json({ objectCreated: { _id: "c2" } }), json({ objectCreated: { _id: "a2" } })]);
    expect((await ensureWallets(fresh, wallNow)).errors).toEqual([]);
    // Two customers and two accounts were written to the sandbox; the sandbox's balance was never read.
    expect(calls.map((call) => `${call.init.method} ${new URL(call.url).pathname}`)).toEqual(["POST /customers", "POST /customers/c1/accounts", "POST /customers", "POST /customers/c2/accounts"]);
    expect(await walletOf(fresh, "aaron")).toMatchObject({ accountId: "a1", source: "nessie", balance: 120 });
    expect((await fresh.getRoom()).localLedger).toEqual({ a1: 120, a2: 80 });
    expect(toUiSnapshot(await fresh.snapshot(), { mode: "live" }).sandbox).toEqual({ enabled: true, connected: true, text: "Capital One Nessie sandbox, balances kept by Muse" });

    // Reset: our ledger says Sprout spent $12, so the same account is topped back up with a deposit record. No new customers.
    await fresh.putRoom({ ...(await fresh.getRoom()), localLedger: { a1: 108, a2: 80 } });
    stub([json({ objectCreated: { _id: "dp1" } })]);
    expect((await ensureWallets(fresh, wallNow)).errors).toEqual([]);
    expect(calls.map((call) => `${call.init.method} ${new URL(call.url).pathname}`)).toEqual(["POST /accounts/a1/deposits"]);
    expect((await fresh.getRoom()).localLedger).toEqual({ a1: 120, a2: 80 });
  });

  it("never asks the sandbox for a balance: the wallet reads our ledger, whatever the sandbox's balance field says", async () => {
    process.env.NESSIE_KEY = "abc123";
    const fresh = new JsonStore(null);
    stub([json({ objectCreated: { _id: "c1" } }), json({ objectCreated: { _id: "a1" } }), json({ objectCreated: { _id: "c2" } }), json({ objectCreated: { _id: "a2" } })]);
    await ensureWallets(fresh, wallNow);
    stub([json({ _id: "a1", balance: 50 }, 200)]);
    const wallet = await refreshWallet(fresh, "aaron", wallNow);
    expect(wallet.data?.balance).toBe(120);
    expect(calls).toHaveLength(0);
  });
});

describe("NessieWithLedger", () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const json = (body: unknown, status = 201) => new Response(JSON.stringify(body), { status });
  const stub = (respond: (url: string, init: RequestInit) => Response) => {
    calls.length = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return respond(url, init);
    }));
  };
  const memory = (initial: Record<string, number> = {}) => {
    let ledger = { ...initial };
    return { read: async () => ({ ...ledger }), write: async (next: Record<string, number>) => void (ledger = { ...next }), exclusive: <T,>(work: () => Promise<T>) => work(), snapshot: () => ledger };
  };
  const made = () => {
    const storage = memory();
    return { storage, client: new NessieWithLedger(new NessieHttp({ key: "abc123" }), storage) };
  };

  it("keeps the balance in the ledger and the transactions in Nessie: a withdrawal and a deposit write records and move our balance", async () => {
    const { storage, client } = made();
    stub((url) => (url.includes("/accounts?") || url.endsWith("/accounts") ? json({ objectCreated: { _id: "acct" } }) : json({ objectCreated: { _id: "tx1" } })));
    await storage.write({ acct: 50, other: 50 });
    expect(await client.withdraw("acct", { amount: 7, description: "x" })).toEqual({ data: { id: "tx1" }, error: null });
    expect(storage.snapshot().acct).toBe(43);
    expect(await client.deposit("other", { amount: 7, description: "y" })).toEqual({ data: { id: "tx1" }, error: null });
    expect(storage.snapshot().other).toBe(57);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/accounts/acct/withdrawals", "/accounts/other/deposits"]);
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({ amount: 7, status: "completed", medium: "balance" });
  });

  it("answers a balance read from the ledger without a request, even when the sandbox would say the opening balance", async () => {
    const { storage, client } = made();
    await storage.write({ acct: 43 });
    stub(() => json({ _id: "acct", balance: 50 }, 200));
    expect(await client.getAccount("acct")).toEqual({ data: { id: "acct", balance: 43, nickname: "" }, error: null });
    expect(calls).toHaveLength(0);
    expect(await client.getAccount("nope")).toEqual({ data: null, error: "no such account" });
  });

  it("refuses an overdraft itself, before the sandbox is asked, and moves nothing when the sandbox refuses a write", async () => {
    const { storage, client } = made();
    await storage.write({ acct: 10 });
    stub(() => json({ message: "boom" }, 500));
    expect(await client.withdraw("acct", { amount: 11, description: "x" })).toEqual({ data: null, error: "insufficient funds" });
    expect(calls).toHaveLength(0);
    expect((await client.withdraw("acct", { amount: 5, description: "x" })).error).toBe("sandbox error 500: boom");
    expect((await client.deposit("acct", { amount: 5, description: "x" })).error).toBe("sandbox error 500: boom");
    expect(storage.snapshot().acct).toBe(10);
    expect(await client.deposit("unknown", { amount: 5, description: "x" })).toEqual({ data: null, error: "no such account" });
  });

  it("reads the transaction records back by id", async () => {
    const http = new NessieHttp({ key: "abc123" });
    stub((url) => (url.includes("/withdrawals/") ? json({ _id: "w1", amount: 7, status: "completed", description: "x" }, 200) : json({ _id: "d1", amount: 7 }, 200)));
    expect(await http.getWithdrawal("w1")).toEqual({ data: { id: "w1", amount: 7, status: "completed", description: "x" }, error: null });
    expect(await http.getDeposit("d1")).toEqual({ data: { id: "d1", amount: 7, status: "", description: "" }, error: null });
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(["/withdrawals/w1", "/deposits/d1"]);
  });

  it("moves the wallet chip's balance through a whole payment on the real sandbox, on our ledger, with one record each side", async () => {
    process.env.NESSIE_KEY = "abc123";
    const fresh = new JsonStore(null);
    let n = 0;
    stub((url) => (url.endsWith("/customers") || url.endsWith("/accounts") ? json({ objectCreated: { _id: `id${++n}` } }) : json({ objectCreated: { _id: `tx${++n}` } })));
    await ensureWallets(fresh, wallNow);
    const { planId } = await injectSignal(fresh, { ...rawShawarmaSignal(), id: "sig_real" }, wallNow);
    const base = (await fresh.getPlan(planId))!;
    await fresh.putPlan({ ...base, state: "confirmed", activity: { kind: "food", title: "Shawarma Point" } });
    await fresh.putPolicy(policy("aaron", 20));
    calls.length = 0;
    const ctx = (agent: AgentId, extra: Partial<PaymentContext> = {}): PaymentContext => ({ store: fresh, agent, planId, wallNow, deliver: localDeliver(fresh, agent), ...extra });

    const sent = (await sendMoney(ctx("aaron"), { to: "lisa", amount: 12, reason: "my half" })) as { paymentId: string };
    const contextId = (await fresh.listThreads()).find((thread) => thread.contextId.startsWith("pay_"))!.contextId;
    expect(await acceptPayment(ctx("lisa", { contextId, planId: undefined }), { paymentId: sent.paymentId })).toMatchObject({ ok: true, balanceBefore: 80, balanceAfter: 92 });
    expect({ aaron: (await walletOf(fresh, "aaron"))!.balance, lisa: (await walletOf(fresh, "lisa"))!.balance }).toEqual({ aaron: 108, lisa: 92 });
    expect(toUiSnapshot(await fresh.snapshot(), { mode: "live" }).wallets).toMatchObject({ aaron: { balance: 108 }, lisa: { balance: 92 } });
    // The sandbox saw exactly the two records and was never asked for a balance.
    expect(calls.map((call) => `${call.init.method} ${new URL(call.url).pathname.replace(/\/[^/]+(?=\/(withdrawals|deposits))/, "/:account")}`)).toEqual(["POST /accounts/:account/withdrawals", "POST /accounts/:account/deposits"]);
    expect(paymentsFrom(await fresh.listMessages())[0]).toMatchObject({ source: "nessie", status: "received", balanceBefore: 80, balanceAfter: 92 });
  });
});

describe("the settle route", () => {
  const post = async (id: string, body: unknown) => {
    const { POST } = await import("@/app/api/plans/[id]/settle/route");
    return POST(new Request("http://localhost:3001/api", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) } as never);
  };
  beforeEach(async () => {
    (globalThis as { __museStore?: unknown }).__museStore = Promise.resolve(store);
    const { resetRunBudget } = await import("@/lib/agent/caps");
    resetRunBudget();
  });
  afterEach(() => {
    (globalThis as { __museStore?: unknown }).__museStore = undefined;
  });

  it("answers 202 and schedules the settle turn", async () => {
    const response = await post(plan.id, { role: "a", note: "split it" });
    expect(response.status).toBe(202);
    expect((await response.json()).data).toMatchObject({ planId: plan.id, status: { state: "working" } });
    expect(scheduled).toHaveLength(1);
  });

  it("answers 409 without a model call when payments are off, and gives the run slot back", async () => {
    await store.putPolicy(policy("aaron", 20, false));
    const { runBudget } = await import("@/lib/agent/caps");
    const response = await post(plan.id, { role: "a" });
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toContain("turn them on");
    expect(scheduled).toHaveLength(0);
    expect(runBudget().room.used).toBe(0);
  });

  it("answers 404 for an unknown plan, 400 for a bad body, and 429 past the run cap", async () => {
    expect((await post("plan_missing", { role: "a" })).status).toBe(404);
    expect((await post(plan.id, { role: "c" })).status).toBe(400);
    process.env.MAX_LIVE_RUNS_PER_ROOM_PER_HOUR = "0";
    try {
      const paused = await post(plan.id, { role: "a" });
      expect(paused.status).toBe(429);
      expect(await paused.json()).toMatchObject({ paused: true });
    } finally {
      delete process.env.MAX_LIVE_RUNS_PER_ROOM_PER_HOUR;
    }
  });

  it("is reachable through the controls route: a person sets the cap", async () => {
    const { POST } = await import("@/app/api/controls/route");
    const response = await POST(new Request("http://localhost:3001/api/controls", { method: "POST", body: JSON.stringify({ type: "payments", side: "b", enabled: true, cap: 25 }) }));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ payments: { enabled: true, capPerPlan: 25 } });
    expect((await store.getPolicy("lisa", "aaron"))?.payments).toEqual({ enabled: true, capPerPlan: 25 });
  });
});
