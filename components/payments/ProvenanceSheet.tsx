import { copy } from "@/lib/ui/copy";
import { ledgerLine, provenanceRows, toolsCalled } from "@/lib/ui/payment-card";
import { formatDollars } from "@/lib/ui/payments";
import type { UiPayment } from "@/lib/ui/types";
import { Sheet } from "./Sheet";

type Props = {
  payment: UiPayment;
  onClose: () => void;
};

/**
 * How the amount was worked out, every line with where it came from: the seeded receipt (labeled seeded and fictional),
 * the person's own note, or the Muse's estimate. A line with no source is not shown. After sending, the ledger ids join.
 */
export function ProvenanceSheet({ payment, onClose }: Props) {
  const rows = provenanceRows(payment);
  const tools = toolsCalled(payment);
  return (
    <Sheet label={copy.provenanceTitle(formatDollars(payment.amount))} onClose={onClose}>
      <h2 className="pr-10 text-[20px] font-bold leading-6">{copy.provenanceTitle(formatDollars(payment.amount))}</h2>
      <p className="mt-1 text-[15px] leading-5 text-muted">{copy.provenanceLine}</p>
      {payment.receipt ? <p className="mt-3 text-[13px] leading-[18px] text-muted">{copy.provenanceReceipt(formatDollars(payment.receipt.total))}</p> : null}
      <ul className="mt-3 divide-y divide-bezel-line">
        {rows.map((row, index) => (
          <li key={`${row.label}-${index}`} className="py-3">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-[15px] leading-5">{row.label}</p>
              <p className="shrink-0 text-[15px] font-semibold tabular-nums leading-5">{row.amount}</p>
            </div>
            <p className="mt-1 inline-block rounded-tile bg-group px-2 py-0.5 text-[12px] leading-4 text-muted">{row.tag}</p>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-3 py-3">
          <p className="text-[15px] font-bold leading-5">{copy.provenanceTogether}</p>
          <p className="text-[17px] font-bold tabular-nums leading-5">{formatDollars(payment.amount)}</p>
        </li>
      </ul>
      {payment.explanation ? (
        <>
          <p className="mt-2 text-[13px] font-semibold leading-[18px] text-muted">{copy.provenanceInWords}</p>
          <p className="mt-1 text-[15px] leading-[22px]">{payment.explanation}</p>
        </>
      ) : null}
      <div className="mt-4 border-t border-bezel-line pt-3 text-[12px] leading-4 text-muted">
        {tools.length > 0 ? <p>{copy.provenanceTools(tools.join(", "))}</p> : null}
        <p className={tools.length > 0 ? "mt-1" : ""}>{ledgerLine(payment)}</p>
        <p className="mt-1">{payment.source === "nessie" ? copy.paymentPaperSandbox : copy.paymentPaperLocal}</p>
      </div>
    </Sheet>
  );
}
