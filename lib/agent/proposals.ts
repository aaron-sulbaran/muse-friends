import { AgentMessage, type AgentId, type PaymentProposal } from "@/lib/protocol";
import { paymentsCheck } from "@/lib/policy";
import { displayName } from "@/lib/seed/fixtures";
import type { Store } from "@/lib/store";
import type { AgentRuntimeContext } from "./context";
import { newId } from "./ids";
import { withLock } from "./lock";
import { sendPaymentMessage } from "./payments";
import { sentOnPlan, SETTLEABLE_STATES } from "./payment-rules";
import { getProposal, putProposal } from "./proposal-store";
import { clientFor, paymentsEnabled, PAYMENTS_OFF_TEXT, refreshWallet, walletOf } from "./wallets";
import { toCentralIso } from "./windows";

// The person's side of a proposed payment (D28). The Muse prepared and explained it; the person decides.
//
//   confirm   runs the same policy and cap checks as always, then the withdrawal, the payment message to the friend's
//             inbox (whose Muse accepts or sends it back) and the ledger. Idempotent: a second confirm answers with the
//             same payment and moves nothing more.
//   decline   records the decision and tells the friend's Muse (a payment_cancelled message); nothing moves. Idempotent.
//
// Only the payer's side may do either. Both take the room's lock on the payment id, so two taps at once are one.

export type ProposalContext = { store: Store; wallNow?: () => number; deliver?: AgentRuntimeContext["deliver"] };

export type ProposalOutcome =
  | { ok: true; already: boolean; proposal: PaymentProposal }
  | { ok: false; status: 403 | 404 | 409 | 422 | 502; error: string };

const nowMs = (ctx: ProposalContext) => ctx.wallNow?.() ?? Date.now();
const at = (ctx: ProposalContext) => toCentralIso(nowMs(ctx));
const lockKey = (paymentId: string) => `proposal:${paymentId}`;

async function failedRow(ctx: ProposalContext, proposal: PaymentProposal, text: string): Promise<void> {
  await ctx.store.appendEvent({
    id: newId("evt", nowMs(ctx)),
    at: at(ctx),
    kind: "payment_failed",
    actor: "system",
    agent: proposal.payer,
    planId: proposal.planId,
    contextId: `pay_${proposal.paymentId}`,
    text: text.slice(0, 240),
  });
}

// A confirm that did not go through leaves the proposal retryable ("failed") and says why.
async function failed(ctx: ProposalContext, proposal: PaymentProposal, reason: string, status: 502 | 422 | 409 = 502): Promise<ProposalOutcome> {
  await putProposal(ctx.store, { ...proposal, status: "failed", error: reason.slice(0, 200) });
  await failedRow(ctx, proposal, reason);
  return { ok: false, status, error: reason };
}

export function confirmProposal(ctx: ProposalContext, paymentId: string, by: AgentId): Promise<ProposalOutcome> {
  return withLock(lockKey(paymentId), () => confirmLocked(ctx, paymentId, by));
}

async function confirmLocked(ctx: ProposalContext, paymentId: string, by: AgentId): Promise<ProposalOutcome> {
  const { store } = ctx;
  if (!paymentsEnabled()) return { ok: false, status: 409, error: PAYMENTS_OFF_TEXT };
  const proposal = await getProposal(store, paymentId);
  if (!proposal) return { ok: false, status: 404, error: "no such payment" };
  if (proposal.payer !== by) return { ok: false, status: 403, error: "only the person this payment is for can confirm it" };
  if (proposal.status === "confirmed") return { ok: true, already: true, proposal };
  if (proposal.status === "declined") return { ok: false, status: 409, error: "this payment was declined" };
  if (proposal.status === "confirming") return { ok: false, status: 409, error: "this payment is already being sent" };

  // The same checks as ever, now: the plan, the cap (counting what is already out), the balance, both wallets.
  const plan = await store.getPlan(proposal.planId);
  if (!plan) return { ok: false, status: 404, error: "the plan for this payment is gone" };
  if (!SETTLEABLE_STATES.includes(plan.state)) return { ok: false, status: 409, error: `the plan is ${plan.state}; money moves only once it is confirmed` };
  const policy = await store.getPolicy(proposal.payer, proposal.payee);
  const refused = paymentsCheck(policy, proposal.amount, await sentOnPlan(store, plan.id, proposal.payer));
  if (refused) return { ok: false, status: 422, error: refused };
  const wallet = await refreshWallet(store, proposal.payer, () => nowMs(ctx));
  if (wallet.error !== null) return failed(ctx, proposal, `Payment failed, sandbox error: ${wallet.error}. Nothing moved.`);
  if (wallet.data.balance < proposal.amount) return { ok: false, status: 422, error: `your balance is $${wallet.data.balance}, which is less than $${proposal.amount}` };
  if (!(await walletOf(store, proposal.payee))) return { ok: false, status: 422, error: `${displayName(proposal.payee)} has no wallet` };
  const client = clientFor(store, wallet.data.source);
  if (!client) return failed(ctx, proposal, "Payment failed, sandbox error: sandbox not connected. Nothing moved.");

  await putProposal(store, { ...proposal, status: "confirming", error: undefined });
  const withdrawal = await client.withdraw(wallet.data.accountId, { amount: proposal.amount, description: `Muse ${proposal.paymentId}: ${proposal.reason}` });
  if (withdrawal.error !== null) return failed(ctx, proposal, `Payment failed, sandbox error: ${withdrawal.error}. Nothing moved.`);

  const message = AgentMessage.parse({
    id: newId("msg", nowMs(ctx)),
    contextId: `pay_${proposal.paymentId}`,
    seq: 1,
    from: proposal.payer,
    to: proposal.payee,
    type: "payment",
    state: "working",
    reason: "settle_up",
    ...(proposal.note ? { note: proposal.note } : {}),
    payment: {
      paymentId: proposal.paymentId,
      planId: proposal.planId,
      amount: proposal.amount,
      currency: "USD",
      reason: proposal.reason,
      source: wallet.data.source,
      payerAccountId: wallet.data.accountId,
      withdrawalId: withdrawal.data.id,
      breakdown: proposal.breakdown,
    },
    at: at(ctx),
  });
  const delivered = await sendPaymentMessage({ store, deliver: ctx.deliver }, message, proposal.proof);
  if (!delivered.ok) {
    // The money left the account but the message did not arrive: put it back, and say so.
    const refund = await client.deposit(wallet.data.accountId, { amount: proposal.amount, description: `Refund of Muse ${proposal.paymentId}: not delivered` });
    return failed(ctx, proposal, `Payment failed, ${delivered.error}. ${refund.error === null ? `Your $${proposal.amount} is back.` : `The refund also failed: ${refund.error}`}`);
  }
  await refreshWallet(store, proposal.payer, () => nowMs(ctx));
  const confirmed: PaymentProposal = { ...proposal, status: "confirmed", error: undefined, decidedAt: at(ctx) };
  await putProposal(store, confirmed);
  return { ok: true, already: false, proposal: confirmed };
}

export function declineProposal(ctx: ProposalContext, paymentId: string, by: AgentId): Promise<ProposalOutcome> {
  return withLock(lockKey(paymentId), () => declineLocked(ctx, paymentId, by));
}

async function declineLocked(ctx: ProposalContext, paymentId: string, by: AgentId): Promise<ProposalOutcome> {
  const { store } = ctx;
  const proposal = await getProposal(store, paymentId);
  if (!proposal) return { ok: false, status: 404, error: "no such payment" };
  if (proposal.payer !== by) return { ok: false, status: 403, error: "only the person this payment is for can decline it" };
  if (proposal.status === "declined") return { ok: true, already: true, proposal };
  if (proposal.status === "confirmed" || proposal.status === "confirming") return { ok: false, status: 409, error: "this payment was already sent; your friend's Muse decides now" };

  const declined: PaymentProposal = { ...proposal, status: "declined", error: undefined, decidedAt: at(ctx) };
  await putProposal(store, declined);
  // The friend's Muse is told, and the message's own Activity row is the record of the decision. If the hop fails the
  // decision still stands (it is the person's, and nothing moved), so the feed gets a row of its own instead.
  const wallet = await walletOf(store, proposal.payer);
  const told = wallet
    ? await sendPaymentMessage(
        { store, deliver: ctx.deliver },
        AgentMessage.parse({
          id: newId("msg", nowMs(ctx)),
          contextId: `pay_${proposal.paymentId}`,
          seq: 1,
          from: proposal.payer,
          to: proposal.payee,
          type: "payment_cancelled",
          state: "rejected",
          reason: "settle_up",
          payment: { paymentId: proposal.paymentId, planId: proposal.planId, amount: proposal.amount, currency: "USD", reason: proposal.reason, source: wallet.source, payerAccountId: wallet.accountId },
          at: at(ctx),
        }),
        undefined,
      )
    : ({ ok: false, error: "no wallet" } as const);
  if (!told.ok) {
    await store.appendEvent({
      id: newId("evt", nowMs(ctx)),
      at: at(ctx),
      kind: "payment_cancelled",
      actor: "human",
      agent: proposal.payer,
      planId: proposal.planId,
      contextId: `pay_${proposal.paymentId}`,
      text: `${displayName(proposal.payer)} declined the $${proposal.amount} for ${displayName(proposal.payee)}. Nothing moved. ${displayName(proposal.payee)}'s Muse could not be told: ${told.error}`,
    });
  }
  return { ok: true, already: false, proposal: declined };
}
