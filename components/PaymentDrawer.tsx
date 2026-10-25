"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copy } from "@/lib/ui/copy";
import type { UiPayment, UiSnapshot } from "@/lib/ui/types";

type Props = {
  payment: UiPayment | null;
  wallets: UiSnapshot["wallets"];
  names: { aaron: string; lisa: string };
  onClose: () => void;
};

/**
 * One payment as the ledger recorded it: the amount, who paid whom, the withdrawal and deposit ids, the
 * receiver's balance around the deposit, and each seat's account. Raw JSON for Q&A, like the message drawer.
 */
export function PaymentDrawer({ payment, wallets, names, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (payment && !element.open) element.showModal();
    if (!payment && element.open) element.close();
  }, [payment]);

  const detail = payment
    ? {
        ...payment,
        payerName: names[payment.from],
        payeeName: names[payment.to],
        payerAccountId: wallets[payment.from]?.accountId,
        payeeAccountId: wallets[payment.to]?.accountId,
      }
    : null;

  async function copyJson() {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(detail, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      aria-label={copy.paymentDrawerTitle}
      className="ml-auto mr-0 h-dvh max-h-dvh w-full max-w-none min-[900px]:w-[520px] animate-drawer-in overflow-y-auto rounded-l-card bg-surface p-6 text-ink backdrop:bg-black/10"
    >
      {detail ? (
        <>
          <header className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[17px] font-semibold leading-[22px]">{copy.paymentDrawerTitle}</h2>
              <p className="text-[13px] leading-[18px] text-muted">
                {detail.payerName} to {detail.payeeName}, {detail.source === "nessie" ? "Capital One sandbox" : "local ledger"}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={copy.drawerClose}
              className="grid size-9 place-items-center rounded-full bg-group transition-colors hover:bg-bubble-muse"
            >
              <X className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </header>
          <div className="mt-5 rounded-group bg-group p-3 font-mono text-[12px] leading-[18px]">
            <pre className="whitespace-pre-wrap break-words">{JSON.stringify(detail, null, 2)}</pre>
          </div>
          <button
            type="button"
            onClick={copyJson}
            className="mt-4 rounded-full bg-group px-4 py-2 text-[13px] font-semibold transition-colors hover:bg-bubble-muse"
          >
            {copied ? "Copied" : copy.drawerCopy}
          </button>
        </>
      ) : null}
    </dialog>
  );
}
