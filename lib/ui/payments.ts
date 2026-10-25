import type { AgentId, UiPayment, UiPlan, UiSnapshot, UiWallet } from "./types";

/*
 * Money on the phones, as the snapshot describes it (UiSnapshot.wallets, payments, paymentsScope, sandbox). Pure,
 * so the rules for what shows can be tested without rendering. Whole paper dollars only: the ledger has no cents.
 */

export function formatDollars(amount: number): string {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

/** What the header chip shows, or null: it only appears on the real Capital One sandbox, never over the local ledger. */
export function walletChipFor(snapshot: Pick<UiSnapshot, "wallets" | "sandbox">, agent: AgentId): { balance: string; label: string } | null {
  const wallet: UiWallet | null = snapshot.wallets[agent];
  if (!wallet || !snapshot.sandbox.enabled || !snapshot.sandbox.connected) return null;
  return { balance: formatDollars(wallet.balance), label: "Capital One sandbox" };
}

/** Which side of a payment this phone's person is on. */
export function sideOfPayment(payment: UiPayment, agent: AgentId): "payer" | "payee" {
  return payment.from === agent ? "payer" : "payee";
}

/** The payments of the plan on screen, oldest first. */
export function paymentsForPlan(snapshot: Pick<UiSnapshot, "payments">, plan: Pick<UiPlan, "id"> | null): UiPayment[] {
  return plan ? snapshot.payments.filter((payment) => payment.planId === plan.id) : [];
}

export type SettleOffer =
  /** Payments are switched off for the whole room: say nothing. */
  | { kind: "hidden" }
  /** This seat has not let its Muse send money: offer to turn it on. */
  | { kind: "turn_on" }
  /** Ready: the person can ask their Muse to settle up. */
  | { kind: "ready"; cap: number }
  /** A payment for this plan is still waiting on the friend's Muse. */
  | { kind: "waiting" };

/**
 * Whether a phone offers "Settle up" after a plan is confirmed. A payment already sent and unanswered blocks a
 * second one; a kept or refunded payment does not (the cap counts only what the friend still holds).
 */
export function settleOffer(snapshot: Pick<UiSnapshot, "paymentsScope" | "payments" | "sandbox">, plan: Pick<UiPlan, "id" | "state"> | null, agent: AgentId): SettleOffer {
  if (!plan || !snapshot.sandbox.enabled) return { kind: "hidden" };
  if (plan.state === "detected" || plan.state === "negotiating" || plan.state === "awaiting_humans" || plan.state === "dropped") return { kind: "hidden" };
  if (snapshot.payments.some((payment) => payment.planId === plan.id && payment.status === "sent")) return { kind: "waiting" };
  const scope = snapshot.paymentsScope[agent];
  return scope.enabled && scope.cap > 0 ? { kind: "ready", cap: scope.cap } : { kind: "turn_on" };
}
