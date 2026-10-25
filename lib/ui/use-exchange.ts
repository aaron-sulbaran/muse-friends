import { useEffect, useState } from "react";
import type { UiPlan } from "./types";

/** How long the finished exchange stays on screen before it folds into the "agreed in n messages" line. */
export const EXCHANGE_HOLD_MS = 2000;

/**
 * Whether the Muses' exchange is still shown in the thread. While they talk it is open; once the plan is agreed it stays
 * a couple of seconds on this phone's own clock, so the last message is seen landing, then folds. A phone that opens on
 * a plan already agreed, or that reloads, starts folded. Only the exchange folds: the Muse's private notes stay.
 */
export function useExchangeOpen(plan: Pick<UiPlan, "history"> | null | undefined): boolean {
  const agreedAt = plan?.history.find((entry) => entry.state === "awaiting_humans")?.at ?? null;
  const [foldedFor, setFoldedFor] = useState<string | null>(() => (agreedAt !== null && Date.now() - Date.parse(agreedAt) >= EXCHANGE_HOLD_MS ? agreedAt : null));

  useEffect(() => {
    if (agreedAt === null) return;
    const wait = Math.min(EXCHANGE_HOLD_MS, Math.max(0, Date.parse(agreedAt) + EXCHANGE_HOLD_MS - Date.now()));
    const timer = setTimeout(() => setFoldedFor(agreedAt), wait);
    return () => clearTimeout(timer);
  }, [agreedAt]);

  return agreedAt === null || foldedFor !== agreedAt;
}
