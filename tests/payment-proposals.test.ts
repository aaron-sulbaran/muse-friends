import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolMeta } from "@/lib/model";
import { injectSignal } from "@/lib/agent/runtime";
import { runSettleTurn } from "@/lib/agent/payment-runtime";
import { readReceipt, sendMoney, type PaymentContext } from "@/lib/agent/payments";
import { confirmProposal, declineProposal } from "@/lib/agent/proposals";
import { getProposal } from "@/lib/agent/proposal-store";
import { paymentsFrom } from "@/lib/agent/payment-rules";
import { ensureWallets, walletOf } from "@/lib/agent/wallets";
import { localDeliver, type ReceiveResult } from "@/lib/agent/wire";
import type { AgentId, Plan, SharePolicy } from "@/lib/protocol";
import { rawShawarmaSignal } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";
import { installWireShim } from "./helpers/wire";

// D28: the agent prepares and explains a payment, the person confirms it, and nothing moves before that.

vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: () => undefined }));

let store: JsonStore;
let plan: Plan;
let clock: number;
const wallNow = () => (clock += 1000);
const policy = (owner: AgentId, cap: number): SharePolicy => ({ owner, friend: owner === "aaron" ? "lisa" : "aaron", tier: "close", categories: {}, payments: { enabled: cap > 0, capPerPlan: cap } });
const balances = async () => ({ aaron: (await walletOf(store, "aaron"))!.balance, lisa: (await walletOf(store, "lisa"))!.balance });
const received: ReceiveResult[] = [];
const deliverAs = (agent: AgentId) => localDeliver(store, agent, (accepted) => received.push(accepted));
const ctx = (agent: AgentId = "aaron", extra: Partial<PaymentContext> = {}): PaymentContext => ({ store, agent, planId: plan.id, wallNow, deliver: deliverAs(agent), ...extra });
const estimate = (amount: number) => [{ label: "My estimate", amount, source: "estimate" }];
const meta = (finished: Array<{ callId: string; name: string }> = [], toolCalls: ToolMeta["toolCalls"] = []): ToolMeta => ({
  responseId: "resp_x",
  model: "muse-spark-1.3",
  call: { responseId: "resp_x", model: "muse-spark-1.3", ms: 800, chained: false, chainRetries: 0, toolNames: [], inputTokens: 10, outputTokens: 5, reasoningTokens: 2, cachedTokens: 0 },
  toolCalls,
  callId: "call_send",
  finishedCalls: finished,
});
const args = (amount: number, extra: Record<string, unknown> = {}) => ({ to: "lisa", amount, reason: "dinner", breakdown: estimate(amount), ...extra });
const confirm = (id: string, by: AgentId = "aaron") => confirmProposal({ store, wallNow, deliver: deliverAs(by) }, id, by);
const decline = (id: string, by: AgentId = "aaron") => declineProposal({ store, wallNow, deliver: deliverAs(by) }, id, by);
async function prepared(amount = 16, extra: Record<string, unknown> = {}): Promise<string> {
  const result = await sendMoney(ctx(), args(amount, extra), meta());
  if (!("paymentId" in result)) throw new Error(`not prepared: ${JSON.stringify(result)}`);
  return result.paymentId;
}

beforeEach(async () => {
  clock = Date.parse("2026-10-25T20:00:00-05:00");
  store = new JsonStore(null);
  delete process.env.NESSIE_KEY;
  delete process.env.PAYMENTS;
  await ensureWallets(store, wallNow);
  const { planId } = await injectSignal(store, { ...rawShawarmaSignal(), id: "sig_prop" }, wallNow);
  plan = { ...(await store.getPlan(planId))!, state: "confirmed", activity: { kind: "food", title: "Shawarma Point", place: "E 6th St" }, window: { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" } };
  await store.putPlan(plan);
  await store.putPolicy(policy("aaron", 20));
  await store.putPolicy(policy("lisa", 0));
  received.length = 0;
});
afterEach(() => {
  removeFakeModel();
  vi.unstubAllGlobals();
  delete process.env.PAYMENTS;
});

describe("preparing a payment", () => {
  it("records a proposal and moves nothing: no money, no thread, no message to the friend", async () => {
    const result = await sendMoney(ctx(), args(16), meta());
    expect(result).toMatchObject({ ok: true, proposed: true, status: "proposed", amount: 16, message: expect.stringContaining("No money has moved") });
    expect(await balances()).toEqual({ aaron: 120, lisa: 80 });
    expect(await store.listMessages()).toHaveLength(0);
    expect(await store.listThreads()).toHaveLength(0);
    const id = (result as { paymentId: string }).paymentId;
    expect(await getProposal(store, id)).toMatchObject({ status: "proposed", payer: "aaron", payee: "lisa", amount: 16, reason: "dinner" });
    const rows = (await store.listEvents()).filter((event) => event.kind.startsWith("payment_"));
    expect(rows.map((row) => row.kind)).toEqual(["payment_proposed"]);
    expect(rows[0].text).toBe("Sprout's Muse prepared $16 for Mochi: dinner. Waiting for Sprout to confirm; nothing has moved.");
  });

  it("refuses a breakdown that does not add up to the amount, and says by how much", async () => {
    const result = await sendMoney(ctx(), args(16, { breakdown: [{ label: "Your plate", amount: 13, source: "estimate" }, { label: "Tax and tip", amount: 2, source: "estimate" }] }), meta());
    expect(result).toEqual({ error: "The breakdown lines add up to $15, not $16. Fix the lines or the amount so they match exactly." });
    expect(await store.getRoom().then((room) => room.proposals)).toBeUndefined();
    expect(await sendMoney(ctx(), args(16, { breakdown: [] }), meta())).toMatchObject({ error: expect.stringContaining("Invalid arguments") });
  });

  it("accepts a deduction as a negative line, so the lines can say who covered what", async () => {
    const result = await sendMoney(ctx(), args(14, { breakdown: [{ label: "Your plate", amount: 13, source: "estimate" }, { label: "Half of tax and tip", amount: 3, source: "estimate" }, { label: "Mochi covered the tip", amount: -2, source: "estimate" }] }), meta());
    expect(result).toMatchObject({ ok: true, amount: 14 });
  });

  it("requires every line to name a real source: a tool call from this turn, the person's note, or estimate", async () => {
    const wrong = await sendMoney(ctx(), args(16, { breakdown: [{ label: "Your plate", amount: 13, source: "call_made_up" }, { label: "Half of tax and tip", amount: 3, source: "note" }] }), meta([{ callId: "call_1_0", name: "read_receipt" }]));
    expect(wrong).toMatchObject({ error: expect.stringMatching(/These lines have no valid source: "Your plate" \(source call_made_up\); "Half of tax and tip" \(source note\)/) });

    const real = [{ label: "Your plate", amount: 13, source: "call_1_0" }, { label: "Half of tax and tip", amount: 3, source: "note" }];
    expect(await sendMoney(ctx("aaron", { note: "split the tax and tip evenly" }), args(16, { breakdown: real }), meta([{ callId: "call_1_0", name: "read_receipt" }]))).toMatchObject({ ok: true });
  });

  it("holds one open proposal per plan, and the scope, the cap and the balance still apply", async () => {
    await prepared(16);
    expect(await sendMoney(ctx(), args(5), meta())).toMatchObject({ error: expect.stringContaining("already prepared $16") });
    const fresh = new JsonStore(null);
    expect(fresh).toBeDefined();
    await store.putPolicy(policy("aaron", 10));
    const id = Object.keys((await store.getRoom()).proposals!)[0];
    await decline(id);
    expect(await sendMoney(ctx(), args(16), meta())).toMatchObject({ error: expect.stringContaining("over your person's cap of $10") });
    await store.putPolicy(policy("aaron", 0));
    expect(await sendMoney(ctx(), args(5), meta())).toMatchObject({ error: expect.stringContaining("Payments are off") });
    await store.putPolicy(policy("aaron", 500));
    expect(await sendMoney(ctx(), args(130), meta())).toMatchObject({ error: "Your balance is $120, which is less than $130." });
  });
});

describe("the seeded receipt", () => {
  it("is read by a tool, labeled seeded and fictional, and hands back its own call id to cite", async () => {
    const result = await readReceipt(ctx(), {}, meta());
    expect(result).toMatchObject({ ok: true, seeded: true, callId: "call_send", receipt: { place: "Shawarma Point", paidBy: "Mochi", tax: 2, tip: 4, total: 30, note: "A seeded demo receipt, not a real one." } });
    const lines = (result as { receipt: { lines: Array<{ line: number; item: string; amount: number; orderedBy: string }> } }).receipt.lines;
    expect(lines).toEqual([
      { line: 1, item: "Chicken shawarma plate", amount: 13, orderedBy: "Sprout" },
      { line: 2, item: "Falafel plate", amount: 11, orderedBy: "Mochi" },
    ]);
    expect(lines.reduce((sum, line) => sum + line.amount, 0) + 2 + 4).toBe(30);
    const row = (await store.listEvents()).find((event) => event.kind === "receipt_read")!;
    expect(row.text).toBe("Sprout's Muse read the receipt for Shawarma Point (seeded, fictional): $30 total, paid by Mochi");
  });

  it("has no receipt for a plan whose place it does not know", async () => {
    await store.putPlan({ ...plan, activity: { kind: "food", title: "Somewhere Else" } });
    expect(await readReceipt(ctx(), {}, meta())).toEqual({ error: "There is no receipt on file for this plan." });
  });

  it("makes the breakdown's sources real tool calls: the model reads the receipt, cites its call id, and the card shows where each number came from", async () => {
    installFakeModel([
      { calls: [{ name: "get_wallet", args: {} }, { name: "read_receipt", args: {} }] },
      {
        calls: [
          {
            name: "send_money",
            args: {
              to: "lisa",
              amount: 16,
              reason: "your share of dinner at Shawarma Point",
              breakdown: [
                { label: "Your plate, chicken shawarma", amount: 13, source: "call_1_1" },
                { label: "Half of tax ($2)", amount: 1, source: "call_1_1" },
                { label: "Half of tip ($4)", amount: 2, source: "call_1_1" },
              ],
            },
          },
        ],
      },
      { text: "I prepared $16: your plate was $13 and your half of tax and tip is $3." },
    ]);
    const result = await runSettleTurn({ store, agent: "aaron", planId: plan.id, note: "pay Mochi back", wallNow, deliver: deliverAs("aaron") });
    expect(result).toMatchObject({ status: "completed" });
    expect(await balances()).toEqual({ aaron: 120, lisa: 80 });

    const [payment] = toUiSnapshot(await store.snapshot(), { mode: "live" }).payments;
    expect(payment).toMatchObject({
      status: "proposed",
      amount: 16,
      from: "aaron",
      to: "lisa",
      receipt: { seeded: true, place: "Shawarma Point", total: 30 },
      explanation: "Your plate, chicken shawarma: $13. Half of tax ($2): $1. Half of tip ($4): $2. Together $16.",
      confirmUrl: `/api/payments/${payment.id}/confirm`,
      declineUrl: `/api/payments/${payment.id}/decline`,
    });
    expect(payment.breakdown).toEqual([
      { label: "Your plate, chicken shawarma", amount: 13, source: "call_1_1", sourceKind: "tool", tool: "read_receipt" },
      { label: "Half of tax ($2)", amount: 1, source: "call_1_1", sourceKind: "tool", tool: "read_receipt" },
      { label: "Half of tip ($4)", amount: 2, source: "call_1_1", sourceKind: "tool", tool: "read_receipt" },
    ]);
    expect(payment.toolCalls?.map((call) => call.name)).toEqual(["get_wallet", "read_receipt", "send_money"]);
    expect(payment.toolCalls?.at(-1)).toEqual({ name: "send_money", args: "$16 to lisa, 3 lines", result: "prepared $16, waiting for your person" });
  });
});

describe("the person confirms", () => {
  it("moves the ledger once, sends the payment with its breakdown to the friend's inbox, and a second confirm changes nothing", async () => {
    const id = await prepared(16, { breakdown: [{ label: "Your plate", amount: 13, source: "estimate" }, { label: "Half of tax and tip", amount: 3, source: "estimate" }] });
    const first = await confirm(id);
    expect(first).toMatchObject({ ok: true, already: false, proposal: { status: "confirmed", decidedAt: expect.any(String) } });
    expect(await balances()).toEqual({ aaron: 104, lisa: 80 });

    const again = await confirm(id);
    expect(again).toMatchObject({ ok: true, already: true });
    expect(await balances()).toEqual({ aaron: 104, lisa: 80 });
    const messages = (await store.listMessages()).map((record) => record.message);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ type: "payment", from: "aaron", to: "lisa", state: "working", payment: { amount: 16, breakdown: [{ amount: 13 }, { amount: 3 }], withdrawalId: expect.stringMatching(/^wd_local_/) } });
    // The friend's Muse is asked to take a turn on it.
    expect(received.map((result) => (result.ok ? result.runTurn : null))).toEqual([true]);
    expect((await store.listEvents()).filter((event) => event.kind === "payment_sent")).toHaveLength(1);
  });

  it("puts the proposing turn's tool calls on the payment message's proof, and into the snapshot after sending", async () => {
    const result = await sendMoney(ctx(), args(16), meta([], [{ name: "get_wallet", args: "", result: "balance read" }]));
    const id = (result as { paymentId: string }).paymentId;
    await confirm(id);
    const [record] = await store.listMessages();
    expect(record.proof?.toolCalls).toEqual([
      { name: "get_wallet", args: "", result: "balance read" },
      { name: "send_money", args: "$16 to lisa, 1 line", result: "prepared $16, waiting for your person" },
    ]);
    const [payment] = toUiSnapshot(await store.snapshot(), { mode: "live" }).payments;
    expect(payment).toMatchObject({ status: "sent", withdrawalId: expect.stringMatching(/^wd_local_/), toolCalls: [{ name: "get_wallet" }, { name: "send_money" }] });
    expect(payment.confirmUrl).toBeUndefined();
    expect(payment.breakdown).toHaveLength(1);
  });

  it("is one withdrawal when two taps land at once", async () => {
    const id = await prepared(16);
    const [a, b] = await Promise.all([confirm(id), confirm(id)]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect([a, b].filter((outcome) => outcome.ok && !outcome.already)).toHaveLength(1);
    expect(await balances()).toEqual({ aaron: 104, lisa: 80 });
    expect(await store.listMessages()).toHaveLength(1);
  });

  it("only the person it is for may confirm, and an unknown payment is a 404", async () => {
    const id = await prepared(16);
    expect(await confirm(id, "lisa")).toMatchObject({ ok: false, status: 403 });
    expect(await confirm("pay_nope")).toMatchObject({ ok: false, status: 404 });
    expect(await balances()).toEqual({ aaron: 120, lisa: 80 });
  });

  it("checks the plan, the cap and the balance again at the moment of confirming", async () => {
    const id = await prepared(16);
    await store.putPolicy(policy("aaron", 10));
    expect(await confirm(id)).toMatchObject({ ok: false, status: 422, error: expect.stringContaining("over your person's cap of $10") });
    await store.putPolicy(policy("aaron", 20));
    await store.putPlan({ ...plan, state: "negotiating" });
    expect(await confirm(id)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("only once it is confirmed") });
    await store.putPlan(plan);
    process.env.PAYMENTS = "off";
    expect(await confirm(id)).toMatchObject({ ok: false, status: 409, error: "Payments are switched off" });
    delete process.env.PAYMENTS;
    expect(await balances()).toEqual({ aaron: 120, lisa: 80 });
    expect((await confirm(id)).ok).toBe(true);
  });

  it("leaves a retryable failure when the message cannot be delivered, with the money back, and the retry works", async () => {
    const id = await prepared(16);
    const failedHop = await confirmProposal({ store, wallNow, deliver: async () => ({ ok: false, status: 503, error: "inbox down" }) }, id, "aaron");
    expect(failedHop).toMatchObject({ ok: false, status: 502, error: expect.stringContaining("Your $16 is back") });
    expect(await balances()).toEqual({ aaron: 120, lisa: 80 });
    expect(await getProposal(store, id)).toMatchObject({ status: "failed", error: expect.stringContaining("Your $16 is back") });
    const [failed] = toUiSnapshot(await store.snapshot(), { mode: "live" }).payments;
    expect(failed).toMatchObject({ status: "failed", confirmUrl: `/api/payments/${id}/confirm`, error: expect.stringContaining("is back") });

    expect((await confirm(id)).ok).toBe(true);
    expect(await balances()).toEqual({ aaron: 104, lisa: 80 });
  });

  it("lets the friend's Muse keep it or send it back after the confirm, and the snapshot follows", async () => {
    const id = await prepared(16);
    await confirm(id);
    const { acceptPayment } = await import("@/lib/agent/payments");
    const contextId = (await store.listThreads())[0].contextId;
    await acceptPayment({ store, agent: "lisa", contextId, wallNow, deliver: deliverAs("lisa") }, { paymentId: id });
    expect(await balances()).toEqual({ aaron: 104, lisa: 96 });
    const ui = toUiSnapshot(await store.snapshot(), { mode: "live" });
    expect(ui.payments).toMatchObject([{ id, status: "received", balanceBefore: 80, balanceAfter: 96 }]);
    expect(ui.wallets).toMatchObject({ aaron: { balance: 104, source: "local" }, lisa: { balance: 96 } });
    expect(ui.sandbox.text).toBe("Sandbox not connected, local ledger");
    expect(paymentsFrom(await store.listMessages())[0]).toMatchObject({ status: "received" });
  });
});

describe("the person declines", () => {
  it("moves nothing, records the decision, and tells the friend's Muse with a cancelled-payment message", async () => {
    const id = await prepared(16);
    const result = await decline(id);
    expect(result).toMatchObject({ ok: true, already: false, proposal: { status: "declined" } });
    expect(await balances()).toEqual({ aaron: 120, lisa: 80 });

    const [record] = await store.listMessages();
    expect(record.message).toMatchObject({ type: "payment_cancelled", from: "aaron", to: "lisa", state: "rejected", payment: { amount: 16, paymentId: id } });
    expect(record.message.payment?.withdrawalId).toBeUndefined();
    expect(await store.getThread(record.message.contextId)).toMatchObject({ state: "rejected", messageCount: 1 });
    // Told, not asked: the friend's Muse has nothing to do about it.
    expect(received.map((delivered) => (delivered.ok ? delivered.runTurn : null))).toEqual([false]);
    const rows = (await store.listEvents()).filter((event) => event.kind.startsWith("payment_"));
    expect(rows.map((row) => row.kind)).toEqual(["payment_proposed", "payment_cancelled", "payment_cancelled"]);
    expect(rows[1].text).toBe("Sprout declined the $16 for Mochi. Nothing moved.");
    expect(rows[2].text).toMatch(/Sprout's person declined the \$16 prepared for Mochi: nothing moved/);
    expect(toUiSnapshot(await store.snapshot(), { mode: "live" }).payments).toMatchObject([{ id, status: "declined" }]);
    expect(toUiSnapshot(await store.snapshot(), { mode: "live" }).payments[0].confirmUrl).toBeUndefined();
  });

  it("is idempotent, cannot be undone by a confirm, and cannot unsend a confirmed payment", async () => {
    const id = await prepared(16);
    await decline(id);
    expect(await decline(id)).toMatchObject({ ok: true, already: true });
    expect(await store.listMessages()).toHaveLength(1);
    expect(await confirm(id)).toMatchObject({ ok: false, status: 409, error: "this payment was declined" });

    const second = new JsonStore(null);
    expect(second).toBeDefined();
    const other = await (async () => {
      await store.putRoom({ ...(await store.getRoom()), proposals: {} });
      return prepared(16);
    })();
    await confirm(other);
    expect(await decline(other)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("already sent") });
    expect(await balances()).toEqual({ aaron: 104, lisa: 80 });
  });

  it("only the person it is for may decline", async () => {
    const id = await prepared(16);
    expect(await decline(id, "lisa")).toMatchObject({ ok: false, status: 403 });
    expect(await decline("pay_nope")).toMatchObject({ ok: false, status: 404 });
    expect((await getProposal(store, id))?.status).toBe("proposed");
  });

  it("stands even if telling the friend's Muse fails: the decision is the person's and nothing moved", async () => {
    const id = await prepared(16);
    const result = await declineProposal({ store, wallNow, deliver: async () => ({ ok: false, status: 503, error: "inbox down" }) }, id, "aaron");
    expect(result).toMatchObject({ ok: true, proposal: { status: "declined" } });
    expect(await balances()).toEqual({ aaron: 120, lisa: 80 });
  });
});

describe("the routes", () => {
  const call = async (path: "confirm" | "decline", id: string, body: unknown) => {
    (globalThis as { __museStore?: unknown }).__museStore = Promise.resolve(store);
    const route = await import(`@/app/api/payments/[id]/${path}/route`);
    const response = await route.POST(new Request(`http://localhost:3001/api/payments/${id}/${path}`, { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });
    return { status: response.status, json: await response.json() };
  };
  let uninstallWire: (() => void) | undefined;
  beforeEach(() => {
    uninstallWire = installWireShim();
  });
  afterEach(() => {
    uninstallWire?.();
    (globalThis as { __museStore?: unknown }).__museStore = undefined;
  });

  it("confirms for side a, answers the same thing a second time, and refuses side b and a bad body", async () => {
    const id = await prepared(16);
    expect((await call("confirm", id, { role: "b" })).status).toBe(403);
    expect((await call("confirm", id, { role: "c" })).status).toBe(400);
    expect((await call("confirm", "pay_nope", { role: "a" })).status).toBe(404);
    const first = await call("confirm", id, { role: "a" });
    expect(first).toMatchObject({ status: 200, json: { data: { payment: { id, status: "confirmed", amount: 16 }, already: false }, error: null } });
    expect((await call("confirm", id, { role: "a" })).json.data.already).toBe(true);
    expect((await call("decline", id, { role: "a" })).status).toBe(409);
    expect(await balances()).toEqual({ aaron: 104, lisa: 80 });
  });

  it("declines for side b's own payment too: both sides can use it", async () => {
    await store.putPolicy(policy("lisa", 30));
    const result = await sendMoney(ctx("lisa"), { to: "aaron", amount: 8, reason: "boba", breakdown: estimate(8) }, meta());
    const id = (result as { paymentId: string }).paymentId;
    expect((await call("decline", id, { role: "a" })).status).toBe(403);
    expect(await call("decline", id, { role: "b" })).toMatchObject({ status: 200, json: { data: { payment: { status: "declined" }, already: false } } });
    expect((await call("decline", id, { role: "b" })).json.data.already).toBe(true);
    expect(await balances()).toEqual({ aaron: 120, lisa: 80 });
  });
});
