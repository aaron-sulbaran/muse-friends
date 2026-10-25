"use client";

import { Wallet } from "lucide-react";
import { useState } from "react";
import { copy } from "@/lib/ui/copy";
import { cardVariant } from "@/lib/ui/payment-card";
import { formatDollars } from "@/lib/ui/payments";
import type { UiPayment } from "@/lib/ui/types";
import { OpenPaymentCard } from "./payments/OpenPaymentCard";
import { ProvenanceSheet } from "./payments/ProvenanceSheet";

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
  if (payment.status === "refunded") return side === "payer" ? copy.paymentSentBackYou : copy.paymentRefundedPayee;
  if (side === "payer") return copy.paymentKept(friendName);
  return payment.balanceBefore !== undefined && payment.balanceAfter !== undefined
    ? copy.paymentKeptYou(formatDollars(payment.balanceBefore), formatDollars(payment.balanceAfter))
    : `${copy.paymentKeptYouPlain} ${amount}`;
}

/**
 * One payment in the chat, in the card its state calls for (D28). A proposal the person has not sent, or one that failed
 * and can be retried, is the proposed card; a declined one is a quiet note that nothing moved; once money has moved the
 * card says where it stands. The friend sees nothing until money has moved. The ledger's ids are one tap away.
 */
export function PaymentCard(props: Props) {
  const variant = cardVariant(props.payment, props.side);
  if (variant === null) return null;
  if (variant === "proposed" || variant === "failed") return <OpenPaymentCard payment={props.payment} friendName={props.friendName} />;
  return <MovedCard {...props} declined={variant === "declined"} />;
}

function MovedCard({ payment, side, friendName, friendMuse, onOpen, declined }: Props & { declined: boolean }) {
  const [why, setWhy] = useState(false);
  const amount = formatDollars(payment.amount);
  const refunded = payment.status === "refunded" && side === "payer";
  const title = declined ? copy.paymentProposedLabel(friendName) : side === "payer" ? copy.paymentSent(amount, friendName) : copy.paymentReceived(amount, friendName);
  return (
    <section aria-label={title} className="max-w-[92%] animate-card-in rounded-card bg-surface p-5 shadow-float">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-tile bg-group">
          <Wallet className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[17px] font-semibold leading-[22px]">
            {declined ? (
              <>
                {title} <s className="font-normal text-faint">{amount}</s>
              </>
            ) : refunded ? (
              <>
                {copy.paymentSent("", friendName).trim()} <s className="font-normal text-faint">{amount}</s>
              </>
            ) : (
              title
            )}
          </h3>
          <p className="mt-0.5 text-[13px] leading-[18px] text-muted">{payment.description ?? payment.reason}</p>
        </div>
      </div>
      <p className={`mt-3 text-[13px] font-semibold leading-[18px] ${payment.status === "received" ? "text-tracking" : ""}`}>
        {declined ? copy.paymentNotSent : statusLine({ payment, side, friendName, friendMuse })}
      </p>
      {payment.breakdown && !declined ? (
        <button type="button" onClick={() => setWhy(true)} className="mt-2 block text-[13px] font-semibold leading-[18px] text-accent hover:underline">
          {side === "payer" ? copy.paymentHowYours : copy.paymentHowTheirs(friendMuse)}
        </button>
      ) : null}
      {onOpen ? (
        <button
          type="button"
          onClick={() => onOpen(payment)}
          className="mt-2 text-[13px] font-semibold leading-[18px] text-accent hover:underline"
        >
          {copy.paymentDetails}
        </button>
      ) : null}
      {why ? <ProvenanceSheet payment={payment} onClose={() => setWhy(false)} /> : null}
    </section>
  );
}
