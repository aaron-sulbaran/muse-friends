import { paymentsCheck } from "@/lib/policy";
import type { ActivityEvent, AgentId, AgentMessage, MessageRecord, Plan, Redaction, SharePolicy, Thread, ToolCallProof } from "@/lib/protocol";
import { displayName } from "@/lib/seed/fixtures";
import type { Store } from "@/lib/store";
import { newId } from "./ids";
import { getProposal } from "./proposal-store";
import { walletOf } from "./wallets";

// The rules of the payments channel that need the store: how much has gone out for a plan, whether a payment
// message is one this app could have sent, and how a payment message is committed. Both ends use them: the
// sender before it moves money, the receiver's inbox before it believes a message.

// Money moves only once there is a plan to settle.
export const SETTLEABLE_STATES: Plan["state"][] = ["confirmed", "scheduled", "reminded", "happened", "followed_up"];

export type PaymentView = {
  paymentId: string;
  planId: string;
  contextId: string;
  payer: AgentId;
  payee: AgentId;
  amount: number;
  reason: string;
  note?: string;
  source: "nessie" | "local";
  withdrawalId?: string;
  payerAccountId: string;
  // sent: waiting on the friend; received: kept; refunded: the friend declined and the money went back.
  status: "sent" | "received" | "refunded";
  depositId?: string;
  balanceBefore?: number;
  balanceAfter?: number;
  // The tools the payer's Muse called on the way to the payment, from the proof on the message.
  toolCalls?: ToolCallProof[];
  at: string;
};

// Every payment in the room, one row per paymentId, oldest first. Derived from the messages, which are the record.
export function paymentsFrom(records: MessageRecord[]): PaymentView[] {
  const views = new Map<string, PaymentView>();
  for (const { message, proof } of records) {
    const payment = message.payment;
    if (!payment) continue;
    if (message.type === "payment") {
      views.set(payment.paymentId, {
        paymentId: payment.paymentId,
        planId: payment.planId,
        contextId: message.contextId,
        payer: message.from,
        payee: message.to,
        amount: payment.amount,
        reason: payment.reason,
        note: message.note,
        source: payment.source,
        withdrawalId: payment.withdrawalId,
        payerAccountId: payment.payerAccountId,
        status: "sent",
        ...(proof?.toolCalls ? { toolCalls: proof.toolCalls } : {}),
        at: message.at,
      });
    } else if (message.type !== "payment_cancelled") {
      const view = views.get(payment.paymentId);
      if (!view) continue;
      view.status = payment.outcome === "accepted" ? "received" : "refunded";
      view.depositId = payment.depositId;
      view.balanceBefore = payment.balanceBefore;
      view.balanceAfter = payment.balanceAfter;
    }
  }
  return [...views.values()];
}

export async function paymentsOnPlan(store: Store, planId: string): Promise<PaymentView[]> {
  return paymentsFrom(await store.listMessages()).filter((payment) => payment.planId === planId);
}

// Dollars this payer has sent for the plan and still has with the friend: a refunded payment does not count.
export async function sentOnPlan(store: Store, planId: string, payer: AgentId): Promise<number> {
  return (await paymentsOnPlan(store, planId)).filter((payment) => payment.payer === payer && payment.status !== "refunded").reduce((total, payment) => total + payment.amount, 0);
}

type Check = { ok: true } | { ok: false; status: 403 | 409 | 422; error: string };

// The extra checks a payment message gets in the receiver's inbox, after the generic ones (identity, seq, turn,
// state, policy text). A message that fails never reaches the other agent and moves no money there.
export async function validatePaymentIncoming(store: Store, message: AgentMessage, senderPolicy: SharePolicy | null): Promise<Check> {
  const payment = message.payment;
  if (!payment) return { ok: false, status: 422, error: "a payment message needs a payment" };
  const plan = await store.getPlan(payment.planId);
  if (!plan) return { ok: false, status: 422, error: "the payment names a plan that does not exist" };
  if (!plan.participants.includes(message.from) || !plan.participants.includes(message.to)) return { ok: false, status: 422, error: "the payment is between people who are not in the plan" };

  const records = await store.listMessages();
  const known = paymentsFrom(records);

  if (message.type === "payment") {
    if (!SETTLEABLE_STATES.includes(plan.state)) return { ok: false, status: 409, error: `the plan is ${plan.state}; money moves only once it is confirmed` };
    if (known.some((entry) => entry.paymentId === payment.paymentId)) return { ok: false, status: 409, error: "this payment was already sent" };
    // D28: nothing moves without the person's confirm, so a payment with no confirmed proposal behind it is refused here too.
    const proposal = await getProposal(store, payment.paymentId);
    if (!proposal || (proposal.status !== "confirming" && proposal.status !== "confirmed") || proposal.payer !== message.from || proposal.amount !== payment.amount) {
      return { ok: false, status: 422, error: "the payment has no confirmed proposal behind it" };
    }
    const wallet = await walletOf(store, message.from);
    // Only act on accounts this app created: the money has to come out of the sender's own wallet.
    if (!wallet || wallet.accountId !== payment.payerAccountId || wallet.source !== payment.source) return { ok: false, status: 422, error: "the payment does not come from the sender's own wallet" };
    const spent = known.filter((entry) => entry.planId === plan.id && entry.payer === message.from && entry.status !== "refunded").reduce((total, entry) => total + entry.amount, 0);
    const refused = paymentsCheck(senderPolicy, payment.amount, spent);
    if (refused) return { ok: false, status: 422, error: refused };
    return { ok: true };
  }

  if (message.type === "payment_cancelled") {
    const proposal = await getProposal(store, payment.paymentId);
    if (!proposal || proposal.status !== "declined" || proposal.payer !== message.from || proposal.payee !== message.to || proposal.amount !== payment.amount) {
      return { ok: false, status: 422, error: "the cancellation does not match a payment the sender's person declined" };
    }
    return { ok: true };
  }

  const original = known.find((entry) => entry.paymentId === payment.paymentId);
  if (!original || original.status !== "sent") return { ok: false, status: 409, error: "there is no open payment to answer" };
  if (original.payer !== message.to || original.payee !== message.from) return { ok: false, status: 422, error: "only the person paid can answer this payment" };
  if (original.amount !== payment.amount) return { ok: false, status: 422, error: "the answer names a different amount" };
  if (payment.outcome === "accepted") {
    const wallet = await walletOf(store, message.from);
    if (!wallet || wallet.accountId !== payment.payeeAccountId) return { ok: false, status: 422, error: "the money was not deposited into the receiver's own wallet" };
  }
  return { ok: true };
}

const money = (amount: number) => `$${amount}`;

function describePayment(message: AgentMessage): { kind: ActivityEvent["kind"]; text: string } {
  const payment = message.payment!;
  const from = displayName(message.from);
  const to = displayName(message.to);
  const where = payment.source === "nessie" ? "Nessie sandbox" : "local ledger";
  if (message.type === "payment") {
    return { kind: "payment_sent", text: `${from}'s Muse sent ${money(payment.amount)} to ${to}'s Muse: ${payment.reason} (${where}, withdrawal ${payment.withdrawalId})` };
  }
  if (message.type === "payment_cancelled") {
    return { kind: "payment_cancelled", text: `${from}'s person declined the ${money(payment.amount)} prepared for ${to}: nothing moved (${where})` };
  }
  if (payment.outcome === "accepted") {
    return { kind: "payment_received", text: `${from}'s Muse accepted ${money(payment.amount)} from ${to}: balance ${money(payment.balanceBefore ?? 0)} to ${money(payment.balanceAfter ?? 0)} (${where}, deposit ${payment.depositId})` };
  }
  return { kind: "payment_declined", text: `${from}'s Muse declined ${money(payment.amount)} from ${to}${message.note ? `: ${message.note}` : ""}. Refunded to ${to} (${where}, refund ${payment.depositId})` };
}

// Commits a payment message: the message, a thread of its own linked to the plan, and one timeline row. Plans are
// never touched, so a payment cannot drop or change a plan. Same shape as commitMessageCore's result.
export async function commitPaymentCore(store: Store, record: MessageRecord, redaction: Redaction | null = null) {
  const { message } = record;
  const payment = message.payment!;
  const existing = await store.getThread(message.contextId);
  const thread: Thread = existing ?? {
    contextId: message.contextId,
    planId: payment.planId,
    initiator: message.from,
    participants: [message.from, message.to],
    state: "working",
    messageCount: 0,
    createdAt: message.at,
    updatedAt: message.at,
  };
  const { kind, text } = describePayment(message);
  const events: ActivityEvent[] = [{ id: newId("evt"), at: message.at, kind, actor: "agent", agent: message.from, contextId: message.contextId, planId: payment.planId, messageId: message.id, text: text.slice(0, 240) }];
  if (redaction) {
    events.push({ id: newId("evt"), at: message.at, kind: "redaction", actor: "system", agent: message.from, contextId: message.contextId, planId: payment.planId, messageId: message.id, redactionId: redaction.id, text: `Policy removed ${redaction.removed.join(", ")} from ${displayName(message.from)}'s payment note` });
  }
  await Promise.all([store.appendMessage(record), store.putThread({ ...thread, state: message.state, messageCount: Math.max(thread.messageCount, message.seq), updatedAt: message.at })]);
  const finish = async () => {
    if (redaction) await store.appendRedaction(redaction);
    for (const row of events) await store.appendEvent(row);
  };
  return { threadState: message.state, capped: false, finish };
}
