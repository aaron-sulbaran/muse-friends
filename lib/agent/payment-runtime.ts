import { runAgentTurn, type TurnResult } from "@/lib/model";
import type { ActivityEvent, AgentId } from "@/lib/protocol";
import { displayName } from "@/lib/seed/fixtures";
import type { Store } from "@/lib/store";
import type { AgentRuntimeContext } from "./context";
import { newId, otherAgent } from "./ids";
import { acceptPayment, type PaymentContext } from "./payments";
import { buildPaymentTools } from "./payment-tools";
import { paymentInstructions, paymentTurnInput, settleTurnInput } from "./payment-prompts";
import { paymentsFrom, sentOnPlan, SETTLEABLE_STATES } from "./payment-rules";
import { PAYMENTS_OFF_TEXT, paymentsEnabled } from "./wallets";
import { toCentralIso } from "./windows";

type Options = { store: Store; wallNow?: () => number; deliver?: AgentRuntimeContext["deliver"] };

export type SettleRefusal = { refused: true; status: 404 | 409 | 422; error: string };

// What could never pay, found before any model call: payments off, no such plan, a plan not yet confirmed, or a
// person who has not turned payments on (or left the cap at zero).
export async function runSettlePreflight(store: Store, agent: AgentId, planId: string): Promise<{ status: 404 | 409 | 422; error: string } | null> {
  if (!paymentsEnabled()) return { status: 409, error: PAYMENTS_OFF_TEXT };
  const plan = await store.getPlan(planId);
  if (!plan) return { status: 404, error: "no such plan" };
  if (!plan.participants.includes(agent)) return { status: 422, error: "that person is not part of this plan" };
  if (!SETTLEABLE_STATES.includes(plan.state)) return { status: 409, error: `the plan is ${plan.state}; money moves only once it is confirmed` };
  const scope = (await store.getPolicy(agent, otherAgent(agent)))?.payments;
  if (!scope?.enabled || scope.capPerPlan <= 0) return { status: 409, error: `Payments are off for ${displayName(agent)}'s Muse: turn them on and set a cap first.` };
  return null;
}

// The payer's side: a settle turn. The agent sees the plan, its cap and its wallet, and decides whether to send
// money and how much. Refused up front (no model call) when there is nothing it could do: payments off, no plan
// yet, or the cap is zero.
export async function runSettleTurn(options: Options & { agent: AgentId; planId: string; note?: string }): Promise<TurnResult | SettleRefusal> {
  const { store, agent, planId } = options;
  const refusal = await runSettlePreflight(store, agent, planId);
  if (refusal) return { refused: true, ...refusal };
  const plan = (await store.getPlan(planId))!;
  const scope = (await store.getPolicy(agent, otherAgent(agent)))!.payments!;

  const ctx: PaymentContext = { store, agent, planId, wallNow: options.wallNow, deliver: options.deliver };
  const { tools, handlers } = buildPaymentTools(ctx, ["get_wallet", "send_money"]);
  const signal = (await store.listSignals()).at(-1) ?? null;
  const nowMs = options.wallNow?.() ?? Date.now();
  const result = await runAgentTurn({
    instructions: paymentInstructions(agent),
    input: settleTurnInput({ agent, plan, signal, nowMs, capPerPlan: scope.capPerPlan, sentOnPlan: await sentOnPlan(store, plan.id, agent), note: options.note }),
    tools,
    handlers,
  });
  if (result.status === "failed") {
    // No fallback here: sending money is the model's decision, and a model that is down decides nothing.
    await store.appendEvent({
      id: newId("evt", nowMs),
      at: toCentralIso(nowMs),
      kind: "payment_failed",
      actor: "agent",
      agent,
      planId,
      text: `Payment not made: ${displayName(agent)}'s Muse could not decide (model error). Nothing was sent.`,
    });
  }
  return result;
}

// The receiver's side: a payment arrived in the inbox. The agent accepts it or sends it back. If the model cannot
// answer, the payment is accepted in code (and marked) rather than left hanging with money already out of the payer.
export async function runPaymentTurn(options: Options & { agent: AgentId; contextId: string }): Promise<TurnResult> {
  const { store, agent, contextId } = options;
  const records = await store.listMessages(contextId);
  const payment = paymentsFrom(records).at(-1);
  const completed = { status: "completed", finalText: "", nudged: false, toolCalls: [], calls: [], totalMs: 0 } satisfies TurnResult;
  if (!payment || payment.payee !== agent || payment.status !== "sent") return completed;

  const ctx: PaymentContext = { store, agent, contextId, planId: payment.planId, wallNow: options.wallNow, deliver: options.deliver };
  const { tools, handlers } = buildPaymentTools(ctx, ["get_wallet", "accept_payment", "decline_payment"]);
  const plan = await store.getPlan(payment.planId);
  const signal = (await store.listSignals()).at(-1) ?? null;
  const nowMs = options.wallNow?.() ?? Date.now();
  const result = await runAgentTurn({
    instructions: paymentInstructions(agent),
    input: paymentTurnInput({ agent, payment, plan, signal, nowMs }),
    tools,
    handlers,
    requiredTools: ["accept_payment", "decline_payment"],
  });
  if (result.status === "failed") {
    const accepted = await acceptPayment(ctx, { paymentId: payment.paymentId });
    if ("ok" in accepted) {
      const event: ActivityEvent = {
        id: newId("evt", nowMs),
        at: toCentralIso(options.wallNow?.() ?? Date.now()),
        kind: "plan_state",
        actor: "agent",
        agent,
        contextId,
        planId: payment.planId,
        text: `Fallback: the model could not reply, so ${displayName(agent)} accepted the payment of $${payment.amount}`,
      };
      await store.appendEvent(event);
      return { ...result, status: "completed", fallback: true };
    }
  }
  return result;
}

