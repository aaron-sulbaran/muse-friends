import { formatDollars } from "./payments";
import { copy } from "./copy";
import type { AgentId, Role, UiBreakdownLine, UiPayment, UiWallet } from "./types";

/*
 * The D28 payment cards, as logic: which card a payment gets, the rows of the "how it was worked out" sheet, and the
 * timing of the hold to send. Pure, so the rules can be tested without rendering.
 */

/** Which card a payment gets. It follows the payment's state; the chat only says that a payment exists. */
export type CardVariant = UiPayment["status"];

/**
 * The payer sees every state. The friend sees a payment only once money has moved: a proposal the payer has not
 * confirmed, declined or failed is the payer's business and moved nothing.
 */
export function cardVariant(payment: Pick<UiPayment, "status">, side: "payer" | "payee"): CardVariant | null {
  if (side === "payer") return payment.status;
  return payment.status === "sent" || payment.status === "received" || payment.status === "refunded" ? payment.status : null;
}

export const roleOfAgent = (agent: AgentId): Role => (agent === "aaron" ? "a" : "b");

/** "$13", or "-$2" for a deduction. */
export function signedDollars(amount: number): string {
  return amount < 0 ? `-${formatDollars(-amount)}` : formatDollars(amount);
}

export function breakdownTotal(lines: UiBreakdownLine[]): number {
  return lines.reduce((total, line) => total + line.amount, 0);
}

/** The lines add up to the amount the person is asked to send. The server refuses a proposal that does not; the sheet checks again. */
export function breakdownAddsUp(payment: Pick<UiPayment, "amount" | "breakdown">): boolean {
  return payment.breakdown !== undefined && breakdownTotal(payment.breakdown) === payment.amount;
}

export type ProvenanceRow = { label: string; amount: string; tag: string };

/** Where a line's number came from, in words. A seeded receipt says it is seeded; nothing is implied to be real. */
export function provenanceTag(line: UiBreakdownLine, payment: Pick<UiPayment, "receipt">): string {
  if (line.sourceKind === "note") return copy.provenanceNote;
  if (line.sourceKind === "estimate") return copy.provenanceEstimate;
  if (line.tool === "read_receipt" && payment.receipt) return copy.provenanceSeededReceipt;
  return line.tool ? copy.provenanceTool(line.tool) : copy.provenanceToolUnknown;
}

/** One row per line, and only for a line that names its source: a number with no source is not shown. */
export function provenanceRows(payment: Pick<UiPayment, "breakdown" | "receipt">): ProvenanceRow[] {
  return (payment.breakdown ?? [])
    .filter((line) => line.source.trim() !== "")
    .map((line) => ({ label: line.label, amount: signedDollars(line.amount), tag: provenanceTag(line, payment) }));
}

/**
 * A tool's name as the sheet lists it. send_money only prepares a payment until the person confirms it (D28), so
 * before that it says so instead of reading as if money had moved.
 */
function toolLabel(name: string, status: UiPayment["status"]): string {
  if (name !== "send_money") return name;
  if (status === "proposed") return copy.toolPrepared("waits for you");
  if (status === "failed") return copy.toolPrepared("nothing moved");
  if (status === "declined") return copy.toolPrepared("not sent");
  return name;
}

/** The tools the payer's Muse called, each once, in the order it first called them. */
export function toolsCalled(payment: Pick<UiPayment, "toolCalls" | "status">): string[] {
  return [...new Set((payment.toolCalls ?? []).map((call) => call.name))].map((name) => toolLabel(name, payment.status));
}

/** The Nessie ids (or the local ledger's) once something was sent; until then, a promise that they will appear. */
export function ledgerLine(payment: Pick<UiPayment, "withdrawalId" | "depositId">): string {
  const ids = [payment.withdrawalId ? `withdrawal ${payment.withdrawalId}` : null, payment.depositId ? `deposit ${payment.depositId}` : null].filter(Boolean);
  return ids.length > 0 ? `Ledger: ${ids.join(", ")}` : copy.provenanceLedgerLater;
}

/** What the confirm sheet shows besides the amount: the wallet before and after, and the cap per plan. */
export function confirmFacts(payment: Pick<UiPayment, "amount">, wallet: Pick<UiWallet, "balance"> | null, cap: number): { wallet: string | null; cap: string | null } {
  return {
    wallet: wallet ? `${formatDollars(wallet.balance)} to ${formatDollars(wallet.balance - payment.amount)}` : null,
    cap: cap > 0 ? formatDollars(cap) : null,
  };
}

/** Pressing and holding fills the pill over this long; letting go early empties it and nothing is sent. */
export const HOLD_MS = 800;

/** How full the pill is after `elapsedMs` of holding, from 0 to 1. Only 1 sends. */
export function holdProgress(elapsedMs: number, holdMs: number = HOLD_MS): number {
  return Math.min(1, Math.max(0, elapsedMs / holdMs));
}
