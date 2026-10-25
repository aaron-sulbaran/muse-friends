import { z } from "zod";
import {
  AgentId,
  AgentMessage,
  NOTE_MAX,
  PAYMENT_MAX_DOLLARS,
  type ActivityEvent,
  type Payment,
  type MessageRecord,
} from "@/lib/protocol";
import { enforceSharePolicy, paymentsCheck } from "@/lib/policy";
import type { ToolMeta } from "@/lib/model";
import { displayName, getPersona } from "@/lib/seed/fixtures";
import type { Store } from "@/lib/store";
import type { AgentRuntimeContext } from "./context";
import { commitMessage } from "./inbound";
import { newId, otherAgent } from "./ids";
import { paymentsFrom, sentOnPlan, SETTLEABLE_STATES, type PaymentView } from "./payment-rules";
import { clientFor, paymentsEnabled, PAYMENTS_OFF_TEXT, refreshWallet, walletOf } from "./wallets";
import { toCentralIso } from "./windows";

// The agents' money tools, executed by the runtime. A model decides whether to pay, how much, and why; the code
// checks the policy cap and the wallet, moves the money on the ledger, and sends the protocol messages. Nothing
// here picks an amount, and every refusal goes back to the model as a plain sentence it can act on.

export type PaymentContext = {
  store: Store;
  agent: AgentId;
  wallNow?: () => number;
  deliver?: AgentRuntimeContext["deliver"];
  // A settle turn is about one plan; a payment turn is about one payment thread.
  planId?: string;
  contextId?: string;
};

export type ToolError = { error: string };
type Done<T> = ({ ok: true } & T) | ToolError;

function fail(error: string): ToolError {
  return { error };
}

export const SendMoneyArgs = z.strictObject({
  to: z.string().min(1).describe('The friend\'s agent id, exactly "aaron" or "lisa" (not a display name)'),
  amount: z.number().int().min(1).max(PAYMENT_MAX_DOLLARS).describe("Whole US dollars, at least 1"),
  reason: z.string().min(1).max(100).describe("What it is for, in a few plain words, no private details"),
  note: z.string().max(NOTE_MAX).optional().describe("Optional friendly sentence for your friend, max 140 characters"),
});
export const PaymentIdArgs = z.strictObject({ paymentId: z.string().min(1).max(64) });
export const DeclineArgs = z.strictObject({ paymentId: z.string().min(1).max(64), reason: z.string().max(NOTE_MAX).optional().describe("Why you are sending it back, one short sentence") });

const nowMs = (ctx: PaymentContext) => ctx.wallNow?.() ?? Date.now();

function proofFrom(meta?: ToolMeta): MessageRecord["proof"] {
  return meta
    ? { model: meta.model, responseId: meta.responseId, latencyMs: meta.call.ms, inputTokens: meta.call.inputTokens, outputTokens: meta.call.outputTokens, reasoningTokens: meta.call.reasoningTokens }
    : undefined;
}

async function failureRow(ctx: PaymentContext, text: string, extra: Partial<ActivityEvent> = {}): Promise<void> {
  const planId = ctx.planId ?? extra.planId;
  await ctx.store.appendEvent({
    id: newId("evt", nowMs(ctx)),
    at: toCentralIso(nowMs(ctx)),
    kind: "payment_failed",
    actor: "agent",
    agent: ctx.agent,
    contextId: ctx.contextId,
    planId,
    text: text.slice(0, 240),
    ...extra,
  });
}

async function send(ctx: PaymentContext, message: AgentMessage, proof: MessageRecord["proof"]): Promise<{ ok: true } | { ok: false; error: string }> {
  const sender = getPersona(message.from);
  const policy = await ctx.store.getPolicy(message.from, message.to);
  const outcome = enforceSharePolicy({ message, policy, sender });
  const final = AgentMessage.safeParse(outcome.message);
  if (!final.success) return { ok: false, error: "the message does not fit the protocol" };
  const record: MessageRecord = { message: final.data, stamp: outcome.stamp, delivery: "delivered", proof };
  if (!ctx.deliver) {
    await commitMessage(ctx.store, record, outcome.redaction);
    return { ok: true };
  }
  const delivery = await ctx.deliver({ record, redaction: outcome.redaction });
  return delivery.ok ? { ok: true } : { ok: false, error: `the friend's inbox rejected it (${delivery.status}): ${delivery.error}` };
}

// A friend's agent id, or their display name, read as the friend. A settle turn is between two people.
function friendOf(ctx: PaymentContext, given: string): AgentId | null {
  const friend = otherAgent(ctx.agent);
  const wanted = given.trim().toLowerCase();
  return wanted === friend || wanted === getPersona(friend).displayName.toLowerCase() ? friend : null;
}

export async function getWallet(ctx: PaymentContext): Promise<Done<{ balance: number; nickname: string; sandbox: string; capPerPlan: number; sentOnThisPlan: number; capLeft: number }> | ToolError> {
  if (!paymentsEnabled()) return fail(PAYMENTS_OFF_TEXT);
  const wallet = await refreshWallet(ctx.store, ctx.agent, () => nowMs(ctx));
  if (wallet.error !== null) return fail(`Your wallet could not be read: ${wallet.error}`);
  const policy = await ctx.store.getPolicy(ctx.agent, otherAgent(ctx.agent));
  const scope = policy?.payments;
  const cap = scope?.enabled ? scope.capPerPlan : 0;
  const spent = ctx.planId ? await sentOnPlan(ctx.store, ctx.planId, ctx.agent) : 0;
  return {
    ok: true,
    balance: wallet.data.balance,
    nickname: wallet.data.nickname,
    sandbox: wallet.data.source === "nessie" ? "Capital One Nessie sandbox" : "local demo ledger (sandbox not connected)",
    capPerPlan: cap,
    sentOnThisPlan: spent,
    capLeft: Math.max(0, cap - spent),
  };
}

// send_money: the payer's side. The withdrawal happens first and is undone (a refund deposit) if the message
// cannot be delivered, so money never disappears into a failed hop.
export async function sendMoney(ctx: PaymentContext, rawArgs: unknown, meta?: ToolMeta): Promise<Done<{ paymentId: string; amount: number; balanceAfter: number; withdrawalId: string }>> {
  if (!paymentsEnabled()) return fail(PAYMENTS_OFF_TEXT);
  const parsed = SendMoneyArgs.safeParse(rawArgs);
  if (!parsed.success) return fail(`Invalid arguments. ${z.prettifyError(parsed.error)}`);
  const args = parsed.data;
  const { store, agent } = ctx;

  const friend = friendOf(ctx, args.to);
  if (!friend) return fail(`You can only pay ${getPersona(otherAgent(agent)).displayName} (to: "${otherAgent(agent)}").`);
  const plan = ctx.planId ? await store.getPlan(ctx.planId) : null;
  if (!plan) return fail("There is no plan to settle.");
  if (!plan.participants.includes(agent) || !plan.participants.includes(friend)) return fail("You and that friend are not both in this plan.");
  if (!SETTLEABLE_STATES.includes(plan.state)) return fail(`The plan is ${plan.state}. Money moves only once the plan is confirmed.`);

  // The cap, as the sender's code sees it. The friend's inbox checks the same thing again.
  const policy = await store.getPolicy(agent, friend);
  const spent = await sentOnPlan(store, plan.id, agent);
  const refused = paymentsCheck(policy, args.amount, spent);
  if (refused) return fail(refused);

  const wallet = await refreshWallet(store, agent, () => nowMs(ctx));
  if (wallet.error !== null) {
    await failureRow(ctx, `Payment failed, sandbox error: ${wallet.error}`, { planId: plan.id });
    return fail(`Payment failed, sandbox error: ${wallet.error}. Nothing was sent.`);
  }
  if (wallet.data.balance < args.amount) return fail(`Your balance is $${wallet.data.balance}, which is less than $${args.amount}.`);
  const payee = await walletOf(store, friend);
  if (!payee) return fail(`${displayName(friend)} has no wallet, so there is nowhere to send money.`);
  const client = clientFor(store, wallet.data.source);
  if (!client) {
    await failureRow(ctx, "Payment failed, sandbox error: sandbox not connected", { planId: plan.id });
    return fail("Payment failed, sandbox error: sandbox not connected. Nothing was sent.");
  }

  const paymentId = newId("pay", nowMs(ctx));
  const withdrawal = await client.withdraw(wallet.data.accountId, { amount: args.amount, description: `Muse ${paymentId}: ${args.reason}` });
  if (withdrawal.error !== null) {
    await failureRow(ctx, `Payment failed, sandbox error: ${withdrawal.error}`, { planId: plan.id });
    return fail(`Payment failed, sandbox error: ${withdrawal.error}. Nothing was sent.`);
  }

  const at = toCentralIso(nowMs(ctx));
  const payment: Payment = {
    paymentId,
    planId: plan.id,
    amount: args.amount,
    currency: "USD",
    reason: args.reason,
    source: wallet.data.source,
    payerAccountId: wallet.data.accountId,
    withdrawalId: withdrawal.data.id,
  };
  const message: AgentMessage = {
    id: newId("msg", nowMs(ctx)),
    contextId: `pay_${paymentId}`,
    seq: 1,
    from: agent,
    to: friend,
    type: "payment",
    state: "working",
    reason: "settle_up",
    ...(args.note ? { note: args.note } : {}),
    payment,
    at,
  };
  const delivered = await send(ctx, message, proofFrom(meta));
  if (!delivered.ok) {
    // The money left the account but the message did not arrive: put it back, and say so.
    const refund = await client.deposit(wallet.data.accountId, { amount: args.amount, description: `Refund of Muse ${paymentId}: not delivered` });
    await failureRow(ctx, `Payment failed, ${delivered.error}. ${refund.error === null ? "Refunded." : `Refund also failed: ${refund.error}`}`, { planId: plan.id, contextId: message.contextId });
    return fail(`Payment failed: ${delivered.error}. ${refund.error === null ? "The money was returned to your wallet." : "The money could not be returned automatically."}`);
  }
  const after = await refreshWallet(store, agent, () => nowMs(ctx));
  return { ok: true, paymentId, amount: args.amount, withdrawalId: withdrawal.data.id, balanceAfter: after.error === null ? after.data.balance : wallet.data.balance - args.amount };
}

async function openPayment(ctx: PaymentContext, paymentId: string): Promise<{ view: PaymentView } | ToolError> {
  if (!paymentsEnabled()) return fail(PAYMENTS_OFF_TEXT);
  if (!ctx.contextId) return fail("There is no payment to answer.");
  const view = paymentsFrom(await ctx.store.listMessages(ctx.contextId)).find((entry) => entry.paymentId === paymentId);
  if (!view) return fail(`There is no payment ${paymentId}. Use the paymentId from the message you were shown.`);
  if (view.payee !== ctx.agent) return fail("This payment is not addressed to you.");
  if (view.status !== "sent") return fail("This payment has already been answered.");
  return { view };
}

// accept_payment: deposit into the receiver's own wallet, read the balance back, tell the payer what happened.
export async function acceptPayment(ctx: PaymentContext, rawArgs: unknown, meta?: ToolMeta): Promise<Done<{ paymentId: string; amount: number; balanceBefore: number; balanceAfter: number; depositId: string }>> {
  const parsed = PaymentIdArgs.safeParse(rawArgs);
  if (!parsed.success) return fail(`Invalid arguments. ${z.prettifyError(parsed.error)}`);
  const opened = await openPayment(ctx, parsed.data.paymentId);
  if ("error" in opened) return opened;
  const { view } = opened;
  const { store, agent } = ctx;

  const wallet = await refreshWallet(store, agent, () => nowMs(ctx));
  if (wallet.error !== null) {
    await failureRow(ctx, `Payment failed, sandbox error: ${wallet.error}`, { planId: view.planId, contextId: view.contextId });
    return fail(`Payment failed, sandbox error: ${wallet.error}. You can try again or decline it.`);
  }
  const client = clientFor(store, wallet.data.source);
  if (!client) return fail("Payment failed, sandbox error: sandbox not connected.");
  const deposit = await client.deposit(wallet.data.accountId, { amount: view.amount, description: `Muse ${view.paymentId} received: ${view.reason}` });
  if (deposit.error !== null) {
    await failureRow(ctx, `Payment failed, sandbox error: ${deposit.error}`, { planId: view.planId, contextId: view.contextId });
    return fail(`Payment failed, sandbox error: ${deposit.error}. You can try again or decline it.`);
  }
  const reread = await refreshWallet(store, agent, () => nowMs(ctx));
  const balanceAfter = reread.error === null ? reread.data.balance : wallet.data.balance + view.amount;

  const message: AgentMessage = {
    id: newId("msg", nowMs(ctx)),
    contextId: view.contextId,
    seq: 2,
    from: agent,
    to: view.payer,
    type: "payment_received",
    state: "completed",
    reason: "settle_up",
    payment: {
      paymentId: view.paymentId,
      planId: view.planId,
      amount: view.amount,
      currency: "USD",
      reason: view.reason,
      source: view.source,
      payerAccountId: view.payerAccountId,
      outcome: "accepted",
      payeeAccountId: wallet.data.accountId,
      depositId: deposit.data.id,
      balanceBefore: wallet.data.balance,
      balanceAfter,
    },
    at: toCentralIso(nowMs(ctx)),
  };
  const delivered = await send(ctx, message, proofFrom(meta));
  if (!delivered.ok) {
    await failureRow(ctx, `Payment received but the receipt could not be delivered: ${delivered.error}`, { planId: view.planId, contextId: view.contextId });
    return fail(`The money arrived in your wallet, but telling your friend failed: ${delivered.error}.`);
  }
  return { ok: true, paymentId: view.paymentId, amount: view.amount, balanceBefore: wallet.data.balance, balanceAfter, depositId: deposit.data.id };
}

// decline_payment: the money already left the payer, so declining sends it back as a refund deposit, honestly labeled.
export async function declinePayment(ctx: PaymentContext, rawArgs: unknown, meta?: ToolMeta): Promise<Done<{ paymentId: string; amount: number; refundId: string }>> {
  const parsed = DeclineArgs.safeParse(rawArgs);
  if (!parsed.success) return fail(`Invalid arguments. ${z.prettifyError(parsed.error)}`);
  const opened = await openPayment(ctx, parsed.data.paymentId);
  if ("error" in opened) return opened;
  const { view } = opened;
  const { store, agent } = ctx;

  const payer = await walletOf(store, view.payer);
  // Only refund into an account this app created for that person.
  if (!payer || payer.accountId !== view.payerAccountId) return fail("The payer's wallet is not one this app created, so nothing can be refunded to it.");
  const client = clientFor(store, payer.source);
  if (!client) return fail("Refund failed, sandbox error: sandbox not connected.");
  const refund = await client.deposit(payer.accountId, { amount: view.amount, description: `Refund of Muse ${view.paymentId}: declined` });
  if (refund.error !== null) {
    await failureRow(ctx, `Refund failed, sandbox error: ${refund.error}`, { planId: view.planId, contextId: view.contextId });
    return fail(`Refund failed, sandbox error: ${refund.error}. Try again.`);
  }
  await refreshWallet(store, view.payer, () => nowMs(ctx));

  const message: AgentMessage = {
    id: newId("msg", nowMs(ctx)),
    contextId: view.contextId,
    seq: 2,
    from: agent,
    to: view.payer,
    type: "payment_received",
    state: "completed",
    reason: "settle_up",
    ...(parsed.data.reason ? { note: parsed.data.reason } : {}),
    payment: {
      paymentId: view.paymentId,
      planId: view.planId,
      amount: view.amount,
      currency: "USD",
      reason: view.reason,
      source: view.source,
      payerAccountId: view.payerAccountId,
      outcome: "declined",
      depositId: refund.data.id,
    },
    at: toCentralIso(nowMs(ctx)),
  };
  const delivered = await send(ctx, message, proofFrom(meta));
  if (!delivered.ok) {
    await failureRow(ctx, `Payment refunded but the answer could not be delivered: ${delivered.error}`, { planId: view.planId, contextId: view.contextId });
    return fail(`The money was sent back, but telling your friend failed: ${delivered.error}.`);
  }
  return { ok: true, paymentId: view.paymentId, amount: view.amount, refundId: refund.data.id };
}
