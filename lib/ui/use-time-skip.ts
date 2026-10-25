"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { postClockAdvance } from "./actions";
import type { ChatItem } from "./chat";
import { SKIP_AFTER_MS, SKIP_BEAT_MS, skipDue, type SkipFrom } from "./time-skip";
import type { UiPlan } from "./types";

/**
 * Runs the automatic time skip on one phone (lib/ui/time-skip.ts). `skipNow` is for the hold row's buttons; otherwise
 * the phone skips by itself after `delayMs`. The clock route moves only a plan still in the state the phone saw, so the
 * two phones and the stage can all ask. Returns the skip this phone is showing before the clock has moved, if any.
 */
export function useTimeSkip(input: { plan: UiPlan | null; items: ChatItem[]; enabled: boolean; delayMs?: number; onChanged: () => void }) {
  const { plan, items, enabled, delayMs = SKIP_AFTER_MS, onChanged } = input;
  const due = enabled ? skipDue(plan, items) : null;
  const key = due && plan ? `${plan.id}:${due}` : null;
  const [showing, setShowing] = useState<string | null>(null);
  const fired = useRef<string | null>(null);
  const latest = useRef({ due, key, onChanged });
  useEffect(() => {
    latest.current = { due, key, onChanged };
  });

  const skipNow = useCallback(() => {
    const { due: from, key: firing } = latest.current;
    if (!from || !firing || fired.current === firing) return;
    fired.current = firing;
    setShowing(firing);
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
    if (!key) return;
    const timer = setTimeout(skipNow, delayMs);
    return () => clearTimeout(timer);
  }, [key, delayMs, skipNow]);

  const pending: SkipFrom | null = showing && showing === key ? due : null;
  return { pending, skipNow };
}
