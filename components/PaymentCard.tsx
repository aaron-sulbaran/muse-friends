import { Wallet } from "lucide-react";
import { copy } from "@/lib/ui/copy";
import { formatDollars } from "@/lib/ui/payments";
import type { UiPayment } from "@/lib/ui/types";

type Props = {
  payment: UiPayment;
  /** Which end of the payment this phone's person is. */
  side: "payer" | "payee";
  friendName: string;
  friendMuse: string;
  /** Opens the payment's ids (the ledger's withdrawal and deposit) in the drawer. */
  onOpen?: (payment: UiPayment) => void;
};

function statusLine({ payment, side, friendName, friendMuse }: Omit<Props, "onOpen">): string {
  const amount = formatDollars(payment.amount);
  if (payment.status === "sent") return side === "payer" ? copy.paymentWaitingFriend(friendMuse) : copy.paymentWaitingYou;
  if (payment.status === "refunded") return side === "payer" ? copy.paymentRefundedPayer(friendMuse) : copy.paymentRefundedPayee;
  if (side === "payer") return copy.paymentKept(friendName);
  return payment.balanceBefore !== undefined && payment.balanceAfter !== undefined
    ? copy.paymentKeptYou(formatDollars(payment.balanceBefore), formatDollars(payment.balanceAfter))
    : `${copy.paymentKeptYouPlain} ${amount}`;
}

/** One payment in the chat: how much, what for, from whom, and where it stands. The ledger's ids are one tap away. */
export function PaymentCard({ payment, side, friendName, friendMuse, onOpen }: Props) {
  const amount = formatDollars(payment.amount);
  const title = side === "payer" ? copy.paymentSent(amount, friendName) : copy.paymentReceived(amount, friendName);
  return (
    <section aria-label={title} className="max-w-[92%] animate-card-in rounded-card bg-surface p-5 shadow-float">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-tile bg-group">
          <Wallet className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[17px] font-semibold leading-[22px]">{title}</h3>
          <p className="mt-0.5 text-[13px] leading-[18px] text-muted">{payment.description ?? payment.reason}</p>
        </div>
      </div>
      <p className={`mt-3 text-[13px] font-semibold leading-[18px] ${payment.status === "received" ? "text-tracking" : ""}`}>
        {statusLine({ payment, side, friendName, friendMuse })}
      </p>
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(payment)}
          className="mt-2 text-[13px] font-semibold leading-[18px] text-accent hover:underline"
        >
          {copy.paymentDetails}
        </button>
      ) : null}
    </section>
  );
}
