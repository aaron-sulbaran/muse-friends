import { z } from "zod";
import {
  AgentId,
  AgentMessage,
  BREAKDOWN_ESTIMATE,
  BREAKDOWN_NOTE,
  Breakdown,
  NOTE_MAX,
  PAYMENT_MAX_DOLLARS,
  breakdownSum,
  type ActivityEvent,
  type MessageRecord,
  type PaymentProposal,
  type ToolCallProof,
  type Wallet,
} from "@/lib/protocol";
import { enforceSharePolicy, paymentsCheck } from "@/lib/policy";
import type { ToolMeta } from "@/lib/model";
import { displayName, getPersona } from "@/lib/seed/fixtures";
import { findReceipt } from "@/lib/seed/receipts";
import { summarizeToolCall } from "@/lib/tool-summary";
import type { Store } from "@/lib/store";
import type { AgentRuntimeContext } from "./context";
import { commitMessage } from "./inbound";
import { newId, otherAgent } from "./ids";
import { openProposalFor, putProposal } from "./proposal-store";
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
  // What the person said when they asked for the settle-up: a breakdown line may cite it as its source.
  note?: string;
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
  breakdown: Breakdown.describe(
    "The lines that add up to the amount, each { label, amount, source }. A deduction is a negative amount. source is the callId a tool returned (read_receipt returns its own callId), the word note (your person's note), or the word estimate. The lines must sum to the amount exactly.",
  ),
});
export const ReadReceiptArgs = z.strictObject({ receipt: z.string().max(64).optional().describe("A receipt id; leave out to read the receipt for this plan's place") });
export const PaymentIdArgs = z.strictObject({ paymentId: z.string().min(1).max(64) });
export const DeclineArgs = z.strictObject({ paymentId: z.string().min(1).max(64), reason: z.string().max(NOTE_MAX).optional().describe("Why you are sending it back, one short sentence") });

const nowMs = (ctx: PaymentContext) => ctx.wallNow?.() ?? Date.now();

// The proof on a payment message, with the tools the agent called on the way here and the call that wrote it
// (one line each, no balances: see lib/tool-summary.ts).
function proofFrom(meta: ToolMeta | undefined, current: { name: string; args: unknown; output: unknown; ms?: number }, after: ToolCallProof[] = []): MessageRecord["proof"] {
  return meta
    ? {
        model: meta.model,
        ...(meta.call.fallbackFrom ? { fallbackFrom: meta.call.fallbackFrom } : {}),
        responseId: meta.responseId,
        latencyMs: meta.call.ms,
        inputTokens: meta.call.inputTokens,
        outputTokens: meta.call.outputTokens,
        reasoningTokens: meta.call.reasoningTokens,
        toolCalls: [...meta.toolCalls, { ...summarizeToolCall({ ...current, ok: true }), ...(current.ms !== undefined ? { ms: current.ms } : {}) }, ...after].slice(-10),
      }
    : undefined;
}

const clip = (text: string) => (text.length > 100 ? `${text.slice(0, 99)}…` : text);

/**
 * The call to the ledger as one more tool call on the payment's proof, so the timeline shows the sandbox like any other
 * tool: `nessie_transfer` / `nessie_deposit` on the Nessie sandbox, `ledger_transfer` / `ledger_deposit` on the local
 * ledger. Counts and ids only; `ms` is the round trip.
 */
export function sandboxCall(direction: "transfer" | "deposit", wallet: Pick<Wallet, "source" | "accountId">, amount: number, recordId: string, ms: number): ToolCallProof {
  const real = wallet.source === "nessie";
  const where = real ? wallet.accountId : "the local ledger";
  return {
    name: `${real ? "nessie" : "ledger"}_${direction}`,
    args: clip(direction === "transfer" ? `$${amount} from ${where}` : `$${amount} to ${where}`),
    result: clip(`${direction === "transfer" ? "withdrawal" : "deposit"} ${recordId} recorded`),
    ms,
  };
}

/** The proof of a proposal, carrying the ledger call after the model's own calls. Nothing when there was no model proof. */
export function withSandboxCall(proof: MessageRecord["proof"], call: ToolCallProof): MessageRecord["proof"] {
  return proof ? { ...proof, toolCalls: [...(proof.toolCalls ?? []), call].slice(-10) } : undefined;
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

export async function sendPaymentMessage(ctx: Pick<PaymentContext, "store" | "deliver">, message: AgentMessage, proof: MessageRecord["proof"]): Promise<{ ok: true } | { ok: false; error: string }> {
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

// Text the model wrote about a payment goes through the same scan as a note: a private event title or an off-category
// value comes back as the fallback instead. Proposals are readable by both phones, so this runs when it is prepared.
function scrubbed(agent: AgentId, friend: AgentId, policy: Awaited<ReturnType<Store["getPolicy"]>>, text: string, fallback: string): string {
  const probe: AgentMessage = {
    id: "msg_scrub",
    contextId: "pay_scrub",
    seq: 1,
    from: agent,
    to: friend,
    type: "payment",
    state: "working",
    reason: "settle_up",
    payment: { paymentId: "pay_scrub", planId: "plan_scrub", amount: 1, currency: "USD", reason: text.slice(0, 100), source: "local", payerAccountId: "acct_scrub", withdrawalId: "wd_scrub" },
    at: "2026-10-25T00:00:00-05:00",
  };
  const out = enforceSharePolicy({ message: probe, policy, sender: getPersona(agent) }).message.payment!.reason;
  return out === text.slice(0, 100) ? text : fallback;
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
    sandbox: wallet.data.source === "nessie" ? "Capital One Nessie sandbox (balances kept by Muse)" : "local demo ledger (sandbox not connected)",
    capPerPlan: cap,
    sentOnThisPlan: spent,
    capLeft: Math.max(0, cap - spent),
  };
}

// send_money: the payer's side, and since D28 it PREPARES a payment, it does not make one. The runtime checks the
// payments scope and cap, the balance and the breakdown (the lines add up to the amount and every source is a tool
// call from this turn, the person's note, or "estimate"), records a proposal on the room, and stops. No withdrawal,
// no message to the friend: the person confirms (lib/agent/proposals.ts) and only then does money move.
export async function sendMoney(ctx: PaymentContext, rawArgs: unknown, meta?: ToolMeta): Promise<Done<{ proposed: true; status: "proposed"; paymentId: string; amount: number; message: string }>> {
  if (!paymentsEnabled()) return fail(PAYMENTS_OFF_TEXT);
  const parsed = SendMoneyArgs.safeParse(rawArgs);
  if (!parsed.success) return fail(`Invalid arguments. ${z.prettifyError(parsed.error)}`);
  const args = parsed.data;
  const { store, agent } = ctx;
  const started = Date.now();

  const friend = friendOf(ctx, args.to);
  if (!friend) return fail(`You can only pay ${getPersona(otherAgent(agent)).displayName} (to: "${otherAgent(agent)}").`);
  const plan = ctx.planId ? await store.getPlan(ctx.planId) : null;
  if (!plan) return fail("There is no plan to settle.");
  if (!plan.participants.includes(agent) || !plan.participants.includes(friend)) return fail("You and that friend are not both in this plan.");
  if (!SETTLEABLE_STATES.includes(plan.state)) return fail(`The plan is ${plan.state}. Money moves only once the plan is confirmed.`);

  // The cap, as the sender's code sees it. It is checked again when the person confirms, and in the friend's inbox.
  const policy = await store.getPolicy(agent, friend);
  const spent = await sentOnPlan(store, plan.id, agent);
  const refused = paymentsCheck(policy, args.amount, spent);
  if (refused) return fail(refused);

  // The breakdown has to add up and every number has to say where it came from.
  const sum = breakdownSum(args.breakdown);
  if (sum !== args.amount) return fail(`The breakdown lines add up to $${sum}, not $${args.amount}. Fix the lines or the amount so they match exactly.`);
  const callIds = new Set((meta?.finishedCalls ?? []).map((call) => call.callId));
  const unsourced = args.breakdown.filter((line) => !(line.source === BREAKDOWN_ESTIMATE || (line.source === BREAKDOWN_NOTE && Boolean(ctx.note)) || callIds.has(line.source)));
  if (unsourced.length > 0) {
    return fail(
      `These lines have no valid source: ${unsourced.map((line) => `"${line.label}" (source ${line.source})`).join("; ")}. A source is the callId a tool returned in this turn (read_receipt returns its own callId), ${ctx.note ? 'the word "note" (your person\'s note), ' : ""}or the word "estimate".`,
    );
  }

  const open = await openProposalFor(store, plan.id, agent);
  if (open) return fail(`You already prepared $${open.amount} (${open.paymentId}) and it is waiting for your person to confirm. Prepare nothing else until they decide.`);
  const wallet = await refreshWallet(store, agent, () => nowMs(ctx));
  if (wallet.error !== null) {
    await failureRow(ctx, `Payment failed, sandbox error: ${wallet.error}`, { planId: plan.id });
    return fail(`Payment failed, sandbox error: ${wallet.error}. Nothing was prepared.`);
  }
  if (wallet.data.balance < args.amount) return fail(`Your balance is $${wallet.data.balance}, which is less than $${args.amount}.`);
  if (!(await walletOf(store, friend))) return fail(`${displayName(friend)} has no wallet, so there is nowhere to send money.`);

  const paymentId = newId("pay", nowMs(ctx));
  const at = toCentralIso(nowMs(ctx));
  const readReceiptCall = (meta?.finishedCalls ?? []).some((call) => call.name === "read_receipt");
  const receipt = readReceiptCall ? findReceipt({ place: plan.activity?.title }) : null;
  const proposal: PaymentProposal = {
    paymentId,
    planId: plan.id,
    payer: agent,
    payee: friend,
    amount: args.amount,
    reason: scrubbed(agent, friend, policy, args.reason, "Settling up"),
    ...(args.note ? { note: args.note } : {}),
    breakdown: args.breakdown.map((line) => ({ ...line, label: scrubbed(agent, friend, policy, line.label, "Item") })),
    ...(meta?.finishedCalls?.length ? { calls: meta.finishedCalls.slice(-10) } : {}),
    ...(receipt ? { receipt: { id: receipt.id, place: receipt.place, seeded: true as const, total: receipt.total } } : {}),
    source: wallet.data.source,
    status: "proposed",
    proof: proofFrom(meta, { name: "send_money", args, output: { amount: args.amount, proposed: true }, ms: Date.now() - started }),
    proposedAt: at,
  };
  await putProposal(store, proposal);
  await store.appendEvent({
    id: newId("evt", nowMs(ctx)),
    at,
    kind: "payment_proposed",
    actor: "agent",
    agent,
    planId: plan.id,
    contextId: `pay_${paymentId}`,
    text: `${displayName(agent)}'s Muse prepared $${args.amount} for ${displayName(friend)}: ${args.reason}. Waiting for ${displayName(agent)} to confirm; nothing has moved.`.slice(0, 240),
  });
  return { ok: true, proposed: true, status: "proposed", paymentId, amount: args.amount, message: "Prepared for your person to confirm. No money has moved, and only they can send it." };
}

// read_receipt: the seeded receipt for the plan's place. Its result carries its own callId so a breakdown line can cite
// it, and says plainly that it is a seeded, fictional fixture.
export async function readReceipt(ctx: PaymentContext, rawArgs: unknown, meta?: ToolMeta): Promise<Done<{ callId: string | undefined; seeded: true; receipt: unknown }>> {
  if (!paymentsEnabled()) return fail(PAYMENTS_OFF_TEXT);
  const parsed = ReadReceiptArgs.safeParse(rawArgs ?? {});
  if (!parsed.success) return fail(`Invalid arguments. ${z.prettifyError(parsed.error)}`);
  const plan = ctx.planId ? await ctx.store.getPlan(ctx.planId) : null;
  const receipt = findReceipt({ id: parsed.data.receipt, place: plan?.activity?.title });
  if (!receipt) return fail("There is no receipt on file for this plan.");
  await ctx.store.appendEvent({
    id: newId("evt", nowMs(ctx)),
    at: toCentralIso(nowMs(ctx)),
    kind: "receipt_read",
    actor: "agent",
    agent: ctx.agent,
    planId: plan?.id,
    text: `${displayName(ctx.agent)}'s Muse read the receipt for ${receipt.place} (seeded, fictional): $${receipt.total} total, paid by ${displayName(receipt.paidBy)}`.slice(0, 240),
  });
  return {
    ok: true,
    callId: meta?.callId,
    seeded: true,
    receipt: {
      id: receipt.id,
      place: receipt.place,
      date: receipt.date,
      paidBy: displayName(receipt.paidBy),
      lines: receipt.lines.map((line) => ({ line: line.n, item: line.item, amount: line.amount, orderedBy: displayName(line.orderedBy) })),
      tax: receipt.tax,
      tip: receipt.tip,
      total: receipt.total,
      note: receipt.provenance.note,
    },
  };
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
  const depositStarted = Date.now();
  const deposit = await client.deposit(wallet.data.accountId, { amount: view.amount, description: `Muse ${view.paymentId} received: ${view.reason}` });
  const depositMs = Date.now() - depositStarted;
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
  const delivered = await sendPaymentMessage(ctx, message, proofFrom(meta, { name: "accept_payment", args: parsed.data, output: { amount: view.amount } }, [sandboxCall("deposit", wallet.data, view.amount, deposit.data.id, depositMs)]));
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
  const delivered = await sendPaymentMessage(ctx, message, proofFrom(meta, { name: "decline_payment", args: parsed.data, output: { amount: view.amount } }));
  if (!delivered.ok) {
    await failureRow(ctx, `Payment refunded but the answer could not be delivered: ${delivered.error}`, { planId: view.planId, contextId: view.contextId });
    return fail(`The money was sent back, but telling your friend failed: ${delivered.error}.`);
  }
  return { ok: true, paymentId: view.paymentId, amount: view.amount, refundId: refund.data.id };
}
