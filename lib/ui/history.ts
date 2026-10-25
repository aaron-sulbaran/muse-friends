import { copy } from "./copy";
import { formatTime, namesFor } from "./format";
import { formatDay, formatDollars } from "./payments";
import type { AgentId, UiPayment, UiSnapshot } from "./types";

/*
 * The wallet sheet's History tab: every payment this seat is part of, one row each, grouped by friend. Pure, so
 * the rows can be tested without rendering.
 */

export type HistoryRow = {
  id: string;
  /** "You sent Michelle $15" or "Michelle sent you $15". */
  who: string;
  /** What the agent said the money was for. */
  why: string;
  /** When it moved: "Sun Oct 25, 4:10 AM". */
  when: string;
  /** The plan it belonged to, by event and day; null when the plan is not known. */
  plan: string | null;
  standing: string;
};

export type HistoryGroup = {
  /** "History with Michelle", only when more than one friend has a payment. */
  title: string | null;
  rows: HistoryRow[];
};

const standingOf = (payment: UiPayment): string =>
  payment.status === "sent" ? copy.historyStandingWaiting : payment.status === "refunded" ? copy.historyStandingBack : copy.historyStandingKept;

const newestFirst = (first: UiPayment, second: UiPayment) => Date.parse(second.at) - Date.parse(first.at);

export function paymentHistory(snapshot: Pick<UiSnapshot, "payments" | "sides" | "simulatedFriend">, agent: AgentId): HistoryGroup[] {
  const names = namesFor(snapshot).human as Partial<Record<string, string>>;
  const mine = snapshot.payments.filter((payment) => payment.from === agent || payment.to === agent).sort(newestFirst);
  const byFriend = new Map<string, UiPayment[]>();
  for (const payment of mine) {
    const friend = payment.from === agent ? payment.to : payment.from;
    byFriend.set(friend, [...(byFriend.get(friend) ?? []), payment]);
  }
  const several = byFriend.size > 1;
  return [...byFriend.entries()].map(([friend, payments]) => {
    const friendName = names[friend] ?? "a friend";
    return {
      title: several ? copy.historyWith(friendName) : null,
      rows: payments.map((payment) => ({
        id: payment.id,
        who: payment.from === agent ? copy.paymentSent(formatDollars(payment.amount), friendName) : copy.paymentReceived(formatDollars(payment.amount), friendName),
        why: payment.reason,
        when: `${formatDay(payment.at)}, ${formatTime(payment.at)}`,
        plan: payment.planLabel ?? null,
        standing: standingOf(payment),
      })),
    };
  });
}
