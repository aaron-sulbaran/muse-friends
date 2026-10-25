"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { postClockAdvance } from "./actions";
import type { ChatItem } from "./chat";
import { SKIP_AFTER_MS, SKIP_BEAT_MS, SKIP_SEPARATOR_FOR, SKIP_SPACING_MS, skipCount, skipDue, skipsByItself, throughSkips, type SkipFrom } from "./time-skip";
import type { UiPlan } from "./types";

/**
 * Runs the time skip on one phone (lib/ui/time-skip.ts). The skip to the reminder waits for the person: it starts only
 * when they tap a calendar button on the hold row (`skipNow`). The skip from the reminder to the next morning starts by
 * itself after `delayMs`. The clock route moves only a plan still in the state the phone saw, so the two phones and the
 * stage can all ask. Returns the skip this phone is showing before the clock has moved, if any.
 */
export function useTimeSkip(input: { plan: UiPlan | null; items: ChatItem[]; enabled: boolean; delayMs?: number; onChanged: () => void }) {
  const { plan, items, enabled, delayMs = SKIP_AFTER_MS, onChanged } = input;
  const due = enabled ? skipDue(plan, items) : null;
  const key = due && plan ? `${plan.id}:${due}` : null;
  const [showing, setShowing] = useState<{ planId: string; from: SkipFrom } | null>(null);
  const fired = useRef<string | null>(null);
  const latest = useRef({ due, key, onChanged });
  useEffect(() => {
    latest.current = { due, key, onChanged };
  });

  const skipNow = useCallback(() => {
    const { due: from, key: firing } = latest.current;
    if (!from || !firing || fired.current === firing) return;
    fired.current = firing;
    setShowing({ planId: firing.slice(0, firing.lastIndexOf(":")), from });
    // The card first, then the clock: the reminder lands under a card that has already been read.
    setTimeout(async () => {
      const result = await postClockAdvance(from);
      // A failed move clears the card and lets the next tap or the presenter's F try again.
      if (!result.ok) {
        fired.current = null;
        setShowing(null);
      }
      latest.current.onChanged();
    }, SKIP_BEAT_MS);
  }, []);

  useEffect(() => {
    if (!key || !due || !skipsByItself(due)) return;
    const timer = setTimeout(skipNow, delayMs);
    return () => clearTimeout(timer);
  }, [key, due, delayMs, skipNow]);

  // The card this phone put up stays until the real one for the same skip is on screen, so it never blinks out between.
  const pending: SkipFrom | null =
    showing && plan?.id === showing.planId && !items.some((item) => item.id === SKIP_SEPARATOR_FOR[showing.from]) ? showing.from : null;
  return { pending, skipNow };
}

/**
 * Shows the skips one at a time. A phone that learns of both at once (it polled past the reminder, or its tab slept)
 * shows the first with its reminder, and the second only `SKIP_SPACING_MS` later. What was already there when the
 * phone opened shows at once. Returns the chat as the phone shows it now.
 */
export function useSkipReveal(items: ChatItem[]): ChatItem[] {
  const count = skipCount(items);
  const [revealed, setRevealed] = useState(count);
  const lastReveal = useRef(0);
  // A reset (or a new plan) takes the skips away: start over from what is there.
  if (count < revealed) setRevealed(count);

  useEffect(() => {
    if (count <= revealed) return;
    const wait = Math.max(0, lastReveal.current + SKIP_SPACING_MS - Date.now());
    const timer = setTimeout(() => {
      lastReveal.current = Date.now();
      setRevealed((shown) => Math.min(shown + 1, count));
    }, wait);
    return () => clearTimeout(timer);
  }, [count, revealed]);

  return revealed >= count ? items : throughSkips(items, revealed);
}
