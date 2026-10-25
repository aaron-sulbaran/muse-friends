import { formatDollars } from "./payments";
import type { StatusGlyph } from "./chat";
import type { AgentId, UiBreakdownLine, UiPayment, UiToolCall, UiWallet } from "./types";
import { copy } from "./copy";

/*
 * What the D28 payment surfaces show for a payment, and the rules behind the one deliberate step. Pure, so the
 * wording for each state and the arithmetic of the provenance can be tested without rendering. Whole paper dollars.
 */

export type PaymentNames = { human: Record<AgentId, string>; muse: Record<AgentId, string> };

export type PaymentAction = "not-now" | "review" | "try-again";

export type PaymentCardView = {
  label: string;
  amount: string;
  /** The amount is struck through when nothing is going to move: declined, failed, sent back. */
  struck: boolean;
  /** One line under the amount: what the payment was for. */
  line: string;
  status: { glyph: StatusGlyph | null; text: string; tone: "muted" | "tracking" | "withheld" } | null;
  actions: PaymentAction[];
  /** The "How Sprout worked this out" link, shown when there is a sourced breakdown to open. */
  why: string | null;
};

/** The same payment, said from whichever end of it the reader is on. */
export function paymentCardView(payment: UiPayment, viewer: AgentId, names: PaymentNames): PaymentCardView {
  const payer = payment.from;
  const payee = payment.to;
  const amount = formatDollars(payment.amount);
  const line = payment.description ?? payment.reason;
  const why = payment.breakdown && payment.breakdown.length > 0 ? copy.payCardWhyLink(names.muse[payer]) : null;
  const base = { amount, line, why };

  if (viewer === payer) {
    const friend = names.human[payee];
    const friendMuse = names.muse[payee];
    switch (payment.status) {
      case "proposed":
        return { ...base, label: copy.payCardLabelPay(friend), struck: false, status: null, actions: ["not-now", "review"] };
      case "sent":
        return { ...base, label: copy.payCardLabelPaid(friend), struck: false, status: { glyph: "talking", text: copy.payCardWaitingMuse(friendMuse), tone: "muted" }, actions: [] };
      case "received":
        return { ...base, label: copy.payCardLabelPaid(friend), struck: false, status: { glyph: "done", text: copy.payCardFriendHasIt(friend), tone: "tracking" }, actions: [] };
      case "refunded":
        return { ...base, label: copy.payCardLabelPaying(friend), struck: true, status: { glyph: null, text: copy.payCardSentBack, tone: "muted" }, actions: [] };
      case "declined":
        return { ...base, label: copy.payCardLabelPaying(friend), struck: true, status: { glyph: null, text: copy.payCardYouDeclined, tone: "muted" }, actions: [] };
      case "failed": {
        // The withdrawal happened and delivery failed: the runtime refunded it, and the payment says so.
        const refunded = payment.withdrawalId !== undefined && payment.depositId !== undefined;
        return {
          ...base,
          label: copy.payCardLabelPaying(friend),
          struck: true,
          status: { glyph: null, text: refunded ? copy.payCardFailedRefunded(amount) : copy.payCardFailed, tone: "withheld" },
          actions: payment.confirmUrl ? ["try-again", "not-now"] : [],
        };
      }
    }
  }

  // The payee's phone reads it as money coming in; a proposal, a decline or a failure is not theirs to see.
  const friend = names.human[payer];
  const ownMuse = names.muse[payee];
  switch (payment.status) {
    case "sent":
      return { ...base, label: copy.payCardLabelPaidYou(friend), struck: false, status: { glyph: "talking", text: copy.payCardCheckingMuse(ownMuse), tone: "muted" }, actions: [] };
    case "received": {
      const kept =
        payment.balanceBefore !== undefined && payment.balanceAfter !== undefined
          ? copy.payCardKeptBalance(ownMuse, formatDollars(payment.balanceBefore), formatDollars(payment.balanceAfter))
          : copy.payCardKept(ownMuse);
      return { ...base, label: copy.payCardLabelPaidYou(friend), struck: false, status: { glyph: "done", text: kept, tone: "tracking" }, actions: [] };
    }
    case "refunded":
      return { ...base, label: copy.payCardLabelReturned(friend), struck: true, status: { glyph: null, text: copy.payCardYouSentBack, tone: "muted" }, actions: [] };
    default:
      return { ...base, label: copy.payCardLabelPaidYou(friend), struck: false, status: null, actions: [] };
  }
}

/** Whether the viewer sees the payment at all: the payee learns of it only once it is on its way. */
export function visibleTo(payment: UiPayment, viewer: AgentId): boolean {
  return viewer === payment.from || payment.status === "sent" || payment.status === "received" || payment.status === "refunded";
}

export type ProvenanceRow = { id: string; label: string; amount: string; tag: string };

/** The tag under a line saying where its number came from, or null when it has no source (then the row is not shown). */
export function sourceTag(line: UiBreakdownLine, payment: Pick<UiPayment, "toolCalls" | "receipt">, museName: string): string | null {
  if (!line.source) return null;
  if (line.sourceKind === "note") return copy.payProvNote;
  if (line.sourceKind === "estimate") return copy.payProvEstimate(museName);
  const tool = line.tool;
  if (!tool) return null;
  const calls = payment.toolCalls ?? [];
  const call = calls.findIndex((entry) => entry.name === tool) + 1;
  if (payment.receipt?.seeded && tool === "read_receipt") return copy.payProvSeededReceipt(tool);
  return call > 0 ? copy.payProvTool(tool, call) : copy.payProvTool(tool, 1);
}

/** The signed amount of a line: a deduction reads as a minus, never as a bare dollar figure. */
function signed(amount: number): string {
  return amount < 0 ? `-${formatDollars(-amount)}` : formatDollars(amount);
}

/** "$13 + $3 = $16": the lines in order, so the total can be checked by eye. */
export function arithmetic(lines: ReadonlyArray<Pick<UiBreakdownLine, "amount">>, total: number): string {
  const parts = lines.map((line, index) => {
    if (index === 0) return signed(line.amount);
    return line.amount < 0 ? `- ${formatDollars(-line.amount)}` : `+ ${formatDollars(line.amount)}`;
  });
  return `${parts.join(" ")} = ${formatDollars(total)}`;
}

export type Provenance = {
  /** The seeded receipt's total, as context above the lines, when the Muse read one. */
  receipt: { label: string; amount: string; tag: string } | null;
  rows: ProvenanceRow[];
  total: { label: string; sum: string };
  /** The footer: tools called, and the ledger ids once the payment has moved. */
  footer: string[];
};

export function provenanceOf(payment: UiPayment, museName: string): Provenance {
  const lines = (payment.breakdown ?? []).filter((line) => line.source !== "");
  const rows = lines.flatMap((line, index): ProvenanceRow[] => {
    const tag = sourceTag(line, payment, museName);
    return tag ? [{ id: `line-${index}`, label: line.label, amount: signed(line.amount), tag }] : [];
  });
  const toolNames = [...new Set((payment.toolCalls ?? []).map((call: UiToolCall) => call.name))];
  const moved = payment.withdrawalId !== undefined;
  const footer = [
    toolNames.length > 0 ? copy.payProvTools(toolNames.join(", ")) : copy.payProvNoTools,
    moved ? copy.payProvIds(payment.withdrawalId ?? "", payment.depositId ?? "pending") : copy.payProvIdsLater,
    copy.payProvSandbox,
  ];
  return {
    receipt: payment.receipt ? { label: copy.payProvReceiptTotal, amount: formatDollars(payment.receipt.total), tag: copy.payProvSeededReceipt("read_receipt") } : null,
    rows,
    total: { label: copy.payProvYourShare, sum: arithmetic(lines, payment.amount) },
    footer,
  };
}

/** What the confirm sheet says about the wallet: the balance now and after, against the cap. */
export function confirmFacts(payment: Pick<UiPayment, "amount">, wallet: Pick<UiWallet, "balance"> | null, cap: number): { wallet: { before: string; after: string } | null; cap: string; withinCap: boolean } {
  return {
    wallet: wallet ? { before: formatDollars(wallet.balance), after: formatDollars(wallet.balance - payment.amount) } : null,
    cap: formatDollars(cap),
    withinCap: payment.amount <= cap,
  };
}

/** The hold fills left to right in 0.8s; letting go early empties it, and only a full bar sends. */
export const HOLD_MS = 800;

export function holdProgress(elapsedMs: number, durationMs: number = HOLD_MS): number {
  if (elapsedMs <= 0) return 0;
  return Math.min(1, elapsedMs / durationMs);
}

export function holdComplete(elapsedMs: number, durationMs: number = HOLD_MS): boolean {
  return elapsedMs >= durationMs;
}
