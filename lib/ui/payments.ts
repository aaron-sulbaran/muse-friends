import { displayTimeZone } from "./format";
import type { AgentId, TimeWindow, UiPayment, UiPlan, UiSnapshot, UiWallet } from "./types";

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
  /** This seat has not let its Muse send money: offer to turn it on. `event` is what is being settled, when the plan names it. */
  | { kind: "turn_on"; event?: string | null }
  /** Ready: the person can ask their Muse to settle up. */
  | { kind: "ready"; cap: number; event?: string | null }
  /** A payment for this plan is still waiting on the friend's Muse. */
  | { kind: "waiting" };

/**
 * Whether a phone offers "Settle up" after a plan is confirmed. A payment already sent and unanswered blocks a
 * second one; a kept or refunded payment does not (the cap counts only what the friend still holds).
 */
export function settleOffer(
  snapshot: Pick<UiSnapshot, "paymentsScope" | "payments" | "sandbox">,
  plan: (Pick<UiPlan, "id" | "state"> & Partial<Pick<UiPlan, "activityTitle" | "window">>) | null,
  agent: AgentId,
): SettleOffer {
  if (!plan || !snapshot.sandbox.enabled) return { kind: "hidden" };
  if (plan.state === "detected" || plan.state === "negotiating" || plan.state === "awaiting_humans" || plan.state === "dropped") return { kind: "hidden" };
  if (snapshot.payments.some((payment) => payment.planId === plan.id && payment.status === "sent")) return { kind: "waiting" };
  const scope = snapshot.paymentsScope[agent];
  const event = plan.activityTitle ? eventLabel({ activityTitle: plan.activityTitle, window: plan.window ?? null }) : null;
  return scope.enabled && scope.cap > 0 ? { kind: "ready", cap: scope.cap, event } : { kind: "turn_on", event };
}

const dayFormat = new Intl.DateTimeFormat("en-US", { timeZone: displayTimeZone, weekday: "short", month: "short", day: "numeric" });

/** "Tue Oct 27": the Central day an instant falls on, written the way the event slides write dates. */
export function formatDay(iso: string): string {
  const part = Object.fromEntries(dayFormat.formatToParts(new Date(iso)).map((entry) => [entry.type, entry.value]));
  return `${part.weekday} ${part.month} ${part.day}`;
}

/** The Central day a plan's window starts. */
export function formatPlanDay(window: TimeWindow): string {
  return formatDay(window.start);
}

/** "Shawarma Point, Tue Oct 27": what the plan is and when, from the snapshot's own plan; the day is left out when there is no window. */
export function eventLabel(plan: Pick<UiPlan, "activityTitle" | "window">): string {
  return plan.window ? `${plan.activityTitle}, ${formatPlanDay(plan.window)}` : plan.activityTitle;
}

/** A reason that starts with a name keeps its capital; "Dinner share" reads lower-case after a comma. */
function afterComma(reason: string): string {
  const [first = ""] = reason.split(" ");
  const keepsCapital = first.includes("'") || first.length < 2 || first === first.toUpperCase() || first.slice(1) !== first.slice(1).toLowerCase();
  return keepsCapital ? reason : `${reason.charAt(0).toLowerCase()}${reason.slice(1)}`;
}

/**
 * A payment named for what it was: the plan's event and day first, then what the money was for ("Shawarma Point,
 * Tue Oct 27, dinner share"). A reason that already names the event is not repeated, only given its day. With no
 * plan to name, the reason stands alone: nothing is invented.
 */
export function describePayment(reason: string, plan: Pick<UiPlan, "activityTitle" | "window"> | null): string {
  const what = reason.trim();
  if (!plan) return what;
  if (what.toLowerCase().includes(plan.activityTitle.toLowerCase())) return plan.window ? `${what}, ${formatPlanDay(plan.window)}` : what;
  return `${eventLabel(plan)}, ${afterComma(what)}`;
}

/** How an amount was worked out, as plain facts: the receipt's total and how many ways it was split. */
export type SplitFacts = { receiptTotal: number; ways: number };

const WAYS = ["", "", "two", "three", "four", "five"];

/** "receipt $30, split two ways", or a pointer to Details when the agent recorded no breakdown. */
function splitText(split: SplitFacts | undefined): string {
  if (!split) return "the split is in Details";
  return `receipt ${formatDollars(split.receiptTotal)}, split ${WAYS[split.ways] || split.ways} ways`;
}

/** The settle card's sentence for a payment that has an amount: who is asking, how much, why, and what the cap allows. */
export function proposalSentence(input: { friend: string; amount: number; reason: string; cap: number; breakdown?: SplitFacts }): string {
  return `${input.friend}'s Muse is asking for ${formatDollars(input.amount)}, ${input.reason} (${splitText(input.breakdown)}). Your Muse can send up to ${formatDollars(input.cap)} without asking again.`;
}

/** The settle card's sentence before any payment has an amount: what is being settled, and how far the cap lets the Muse go. */
export function settleDetailFor(input: { cap: number; event: string | null | undefined; friendMuse: string }): string {
  const share = input.event ? `your share of ${input.event}` : "your share";
  return `Your Muse will work out ${share} and can send up to ${formatDollars(input.cap)} without asking again. ${input.friendMuse} accepts it or sends it back.`;
}

/** The line that sits above the ledger's JSON in the payment drawer: who paid whom, how much, what for, where it stands. */
export function paymentSummary(payment: UiPayment, names: Record<AgentId, string>, split?: SplitFacts): string {
  const payee = names[payment.to];
  const standing = payment.status === "sent" ? `Waiting on ${payee}.` : payment.status === "received" ? `${payee} kept it.` : `${payee} sent it back.`;
  const how = split ? ` ${splitText(split).replace(/^./, (first) => first.toUpperCase())}.` : "";
  return `${names[payment.from]} sent ${payee} ${formatDollars(payment.amount)} for ${payment.description ?? payment.reason}. ${standing}${how}`;
}

/**
 * The Activity row for a payment that was sent, with the plan's event and day where the agent's own words had only
 * the reason ("...: dinner share (Nessie sandbox, ...)"). The ids stay in the row for Q&A. A row that cannot be
 * matched to a payment is left exactly as the agent wrote it.
 */
export function describeNote(text: string, payments: UiPayment[]): string {
  const payment = payments.find((entry) => entry.withdrawalId && text.includes(`withdrawal ${entry.withdrawalId}`) && text.includes(`: ${entry.reason} (`));
  return payment?.description ? text.replace(`: ${payment.reason} (`, `: ${payment.description} (`) : text;
}
