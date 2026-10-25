"use client";

import { copy } from "@/lib/ui/copy";
import { paymentHistory, type HistoryGroup } from "@/lib/ui/history";
import { useSnapshot } from "@/lib/ui/use-snapshot";
import type { AgentId } from "@/lib/ui/types";

/** The rows of the History tab: who, why, when and the plan, one payment each, grouped by friend when there is more than one. */
export function PaymentHistory({ groups }: { groups: HistoryGroup[] }) {
  if (groups.length === 0) return <p className="py-3 text-[14px] leading-5 text-muted">{copy.historyEmpty}</p>;
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group, index) => (
        <section key={group.title ?? index} aria-label={group.title ?? copy.paymentsTabHistory}>
          {group.title ? <h4 className="text-[13px] font-semibold leading-[18px] text-muted">{group.title}</h4> : null}
          <ul className="divide-y divide-bezel-line">
            {group.rows.map((row) => (
              <li key={row.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[15px] font-semibold leading-5">{row.who}</p>
                  <p className="shrink-0 text-[12px] font-semibold leading-4 text-muted">{row.standing}</p>
                </div>
                <p className="text-[13px] leading-[18px]">{row.why}</p>
                {row.plan ? <p className="text-[12px] leading-4 text-muted">For {row.plan}</p> : null}
                <p className="text-[12px] leading-4 text-muted">{row.when}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** The History tab on a phone: reads the room's snapshot while the tab is open, since the sheet is handed only settings. */
export function PaymentHistoryLive({ agent }: { agent: AgentId }) {
  const { snapshot } = useSnapshot();
  if (!snapshot) return <p className="py-3 text-[14px] leading-5 text-muted">{copy.historyLoading}</p>;
  return <PaymentHistory groups={paymentHistory(snapshot, agent)} />;
}
