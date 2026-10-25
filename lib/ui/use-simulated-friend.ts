"use client";

import { useEffect, useRef } from "react";
import { postSimulatedAnswer } from "./actions";
import { useSimulatedMember } from "./use-simulated-member";
import type { UiSnapshot } from "./types";

/**
 * While the simulated friend has a card waiting, ask the server to answer it, once per
 * plan from this page (the server answers once overall). Never runs over a recording.
 */
export function useSimulatedFriend(snapshot: UiSnapshot | null, onChanged: () => void, enabled = true, onPaused?: (text: string) => void) {
  // In a plan for three the model also plays Kai, who has no phone; a no-op for every other plan.
  useSimulatedMember(snapshot, onChanged, enabled, onPaused);
  const asked = useRef(new Set<string>());
  const plan = snapshot?.plan ?? null;
  const waiting = enabled && snapshot?.simulatedFriend === true && plan?.state === "awaiting_humans" && plan.decisions.b === "pending" && plan.kind !== "trip";
  const planId = waiting ? plan.id : null;

  useEffect(() => {
    if (!planId || asked.current.has(planId)) return;
    asked.current.add(planId);
    void postSimulatedAnswer(planId).then((result) => {
      // A failed answer may be retried once the next time this plan is seen waiting; a paused budget is not retried.
      if (!result.ok && !result.paused) asked.current.delete(planId);
      if (!result.ok && result.paused) onPaused?.(result.message);
      onChanged();
    });
  }, [planId, onChanged, onPaused]);
}
