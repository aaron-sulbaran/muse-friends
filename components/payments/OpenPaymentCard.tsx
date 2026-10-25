"use client";

import { useState } from "react";
import { postDeclinePayment } from "@/lib/ui/actions";
import { copy } from "@/lib/ui/copy";
import { roleOfAgent } from "@/lib/ui/payment-card";
import { formatDollars } from "@/lib/ui/payments";
import type { UiPayment } from "@/lib/ui/types";
import { ConfirmSheet } from "./ConfirmSheet";
import { ProvenanceSheet } from "./ProvenanceSheet";

type Props = {
  payment: UiPayment;
  friendName: string;
};

const primary = "whitespace-nowrap rounded-full bg-accent px-4 py-2.5 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 active:brightness-90 disabled:opacity-50";
const secondary = "rounded-full bg-group px-4 py-2.5 text-[15px] font-semibold transition-colors hover:bg-bubble-muse disabled:opacity-50";

/**
 * A payment the Muse prepared and the person has not sent (proposed), or one whose send did not go through and can be
 * tried again (failed). The amount leads, the way it was worked out is one tap away, and nothing moves until the person
 * confirms on the sheet.
 */
export function OpenPaymentCard({ payment, friendName }: Props) {
  const [sheet, setSheet] = useState<"why" | "confirm" | null>(null);
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const failed = payment.status === "failed";
  const amount = formatDollars(payment.amount);
  const label = copy.paymentProposedLabel(friendName);

  async function notNow() {
    if (!payment.declineUrl) return;
    setDeclining(true);
    setError(null);
    const result = await postDeclinePayment(payment.declineUrl, roleOfAgent(payment.from));
    if (!result.ok) {
      setDeclining(false);
      setError(result.message);
    }
  }

  return (
    <>
      <section aria-label={`${label}, ${amount}`} className="max-w-[92%] animate-card-in rounded-card bg-surface p-5 shadow-float">
        <p className="text-[13px] font-semibold leading-[18px] text-muted">{label}</p>
        <p className={`mt-1 text-[40px] font-bold leading-[44px] tabular-nums ${failed ? "text-faint line-through" : ""}`}>{amount}</p>
        <p className="mt-1 text-[15px] leading-5">{payment.description ?? payment.reason}</p>
        {failed ? (
          <>
            <p role="alert" className="mt-2 text-[13px] font-semibold leading-[18px] text-withheld">
              {copy.paymentDidntGoThrough}
            </p>
            {payment.error ? <p className="mt-0.5 text-[12px] leading-4 text-muted">{payment.error}</p> : null}
          </>
        ) : null}
        {payment.breakdown ? (
          <button type="button" onClick={() => setSheet("why")} className="mt-2 text-[13px] font-semibold leading-[18px] text-accent hover:underline">
            {copy.paymentHowYours}
          </button>
        ) : null}
        <div className="mt-4 grid grid-cols-[2fr_3fr] gap-2.5">
          <button type="button" disabled={declining || !payment.declineUrl} onClick={notNow} className={secondary}>
            {copy.paymentNotNow}
          </button>
          <button type="button" disabled={declining || !payment.confirmUrl} onClick={() => setSheet("confirm")} className={primary}>
            {failed ? copy.paymentTryAgain : copy.paymentReview}
          </button>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-[13px] leading-[18px] text-withheld">
            {error}
          </p>
        ) : null}
      </section>
      {payment.breakdown && !failed ? (
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => setSheet("why")} className="rounded-full bg-group px-3.5 py-2 text-[13px] font-semibold leading-[18px] transition-colors hover:bg-bubble-muse">
            {copy.paymentWhy(amount)}
          </button>
        </div>
      ) : null}
      {sheet === "why" ? <ProvenanceSheet payment={payment} onClose={() => setSheet(null)} /> : null}
      {sheet === "confirm" ? <ConfirmSheet payment={payment} friendName={friendName} onClose={() => setSheet(null)} /> : null}
    </>
  );
}
