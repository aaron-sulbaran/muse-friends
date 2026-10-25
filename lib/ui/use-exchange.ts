import { useEffect, useState } from "react";
import type { UiPlan } from "./types";

/** How long the finished exchange stays on screen, once this phone has it, before it folds into the "agreed in n messages" line. */
export const EXCHANGE_HOLD_MS = 2000;

/** An agreement older than this when the phone first sees it was not watched happen (a reload, a recording): it starts folded. */
export const EXCHANGE_FRESH_MS = 8000;

/** How long to keep the finished exchange on screen: the full hold for an agreement this phone is watching happen, none for an old one. */
export function exchangeHoldFor(agreedAt: string, now: number): number {
  return now - Date.parse(agreedAt) >= EXCHANGE_FRESH_MS ? 0 : EXCHANGE_HOLD_MS;
}

/**
 * Whether the Muses' exchange is still shown in the thread. While they talk it is open; once the plan is agreed it stays
 * a couple of seconds from when this phone first has it (so the last message is seen landing whatever the poll delay), then
 * folds. A phone that opens on a plan agreed a while ago, or that reloads, starts folded. Only the exchange folds: the
 * Muse's private notes stay.
 */
export function useExchangeOpen(plan: Pick<UiPlan, "history"> | null | undefined): boolean {
  const agreedAt = plan?.history.find((entry) => entry.state === "awaiting_humans")?.at ?? null;
  const [foldedFor, setFoldedFor] = useState<string | null>(() => (agreedAt !== null && exchangeHoldFor(agreedAt, Date.now()) === 0 ? agreedAt : null));

  useEffect(() => {
    if (agreedAt === null) return;
    const timer = setTimeout(() => setFoldedFor(agreedAt), exchangeHoldFor(agreedAt, Date.now()));
    return () => clearTimeout(timer);
  }, [agreedAt]);

  return agreedAt === null || foldedFor !== agreedAt;
}
