import { useEffect, useState } from "react";
import { FRIEND_REPLY_DELAY_MS, handoffAt } from "./thread";
import type { UiPlan } from "./types";

/**
 * Whether the simulated friend's answer to the person's message is due yet. The line is drawn a few seconds after the
 * handoff so it reads as a reply and not an echo; the wait runs on this phone's own clock, capped at the delay in case
 * the server's clock is ahead. Once the plan has moved on to the reminder or the follow-up the day has been skipped, so
 * nothing waits for her.
 */
export function useFriendReplied(plan: Pick<UiPlan, "history" | "state"> | null | undefined): boolean {
  const handoff = handoffAt(plan);
  const skippedAhead = plan?.state === "reminded" || plan?.state === "followed_up";
  const [waitedOut, setWaitedOut] = useState<string | null>(null);

  useEffect(() => {
    if (!handoff) return;
    const wait = Math.min(FRIEND_REPLY_DELAY_MS, Math.max(0, Date.parse(handoff) + FRIEND_REPLY_DELAY_MS - Date.now()));
    const timer = setTimeout(() => setWaitedOut(handoff), wait);
    return () => clearTimeout(timer);
  }, [handoff]);

  return !handoff || skippedAhead || waitedOut === handoff;
}
