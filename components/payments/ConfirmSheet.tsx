"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { postConfirmPayment } from "@/lib/ui/actions";
import { copy } from "@/lib/ui/copy";
import { confirmFacts, roleOfAgent } from "@/lib/ui/payment-card";
import { formatDollars } from "@/lib/ui/payments";
import type { UiPayment, UiSnapshot } from "@/lib/ui/types";
import { useSnapshot } from "@/lib/ui/use-snapshot";
import { Elapsed } from "../Elapsed";
import { PersonDisc } from "../PersonDisc";
import { HoldToConfirm } from "./HoldToConfirm";
import { Sheet } from "./Sheet";

type Props = {
  payment: UiPayment;
  friendName: string;
  onClose: () => void;
};

/** The confirm sheet's numbers come from the live snapshot: the payer's wallet now, and the cap they set. */
function Facts({ payment, snapshot }: { payment: UiPayment; snapshot: UiSnapshot | null }) {
  const facts = confirmFacts(payment, snapshot?.wallets[payment.from] ?? null, snapshot?.paymentsScope[payment.from].cap ?? 0);
  if (!facts.wallet && !facts.cap) return null;
  return (
    <div className="mt-4 rounded-group bg-group p-3 text-[14px] leading-5">
      {facts.wallet ? <p>{copy.confirmWallet(facts.wallet)}</p> : null}
      {facts.cap ? <p className={facts.wallet ? "mt-1" : ""}>{copy.confirmCap(facts.cap)}</p> : null}
    </div>
  );
}

/**
 * The one deliberate step (D28): who it goes to, how much, what it is for, the wallet before and after, and a pill you
 * hold to send. Money moves only when the confirm route is called, and that happens only from here.
 */
export function ConfirmSheet({ payment, friendName, onClose }: Props) {
  const { snapshot } = useSnapshot();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = formatDollars(payment.amount);

  // The card behind the sheet changes once the payment is sent, which closes this; this is only the backstop.
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(onClose, 6000);
    return () => clearTimeout(timer);
  }, [pending, onClose]);

  async function send() {
    if (!payment.confirmUrl) {
      setError("This payment can no longer be sent.");
      return;
    }
    setPending(true);
    setError(null);
    const result = await postConfirmPayment(payment.confirmUrl, roleOfAgent(payment.from));
    if (!result.ok) {
      setPending(false);
      setError(result.message);
    }
  }

  return (
    <Sheet label={copy.confirmTitle(friendName)} onClose={onClose}>
      <div className="flex flex-col items-center text-center">
        <PersonDisc name={friendName} size={44} />
        <h2 className="mt-2 text-[17px] font-semibold leading-[22px]">{copy.confirmTitle(friendName)}</h2>
        <p className="mt-2 text-[64px] font-bold leading-[72px] tabular-nums">{amount}</p>
        <p className="mt-1 text-[15px] leading-5 text-muted">{payment.description ?? payment.reason}</p>
      </div>
      <Facts payment={payment} snapshot={snapshot} />
      <p className="mt-3 text-center text-[12px] leading-4 text-muted">{payment.source === "nessie" ? copy.paymentPaperSandbox : copy.paymentPaperLocal}</p>
      <div className="mt-4">
        {pending ? (
          <p role="status" className="flex items-center justify-center gap-2 rounded-full bg-group px-4 py-3.5 text-[16px] font-semibold">
            <LoaderCircle className="size-[18px] animate-spin" strokeWidth={2} aria-hidden="true" />
            <span>
              {copy.confirmSending}, <Elapsed />
            </span>
          </p>
        ) : (
          <HoldToConfirm amount={amount} friend={friendName} onConfirm={send} />
        )}
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-center text-[13px] leading-[18px] text-withheld">
          {error}
        </p>
      ) : null}
      <button type="button" onClick={onClose} className="mt-3 w-full rounded-full px-4 py-2.5 text-[15px] font-semibold text-muted transition-colors hover:bg-group">
        {copy.confirmCancel}
      </button>
    </Sheet>
  );
}
