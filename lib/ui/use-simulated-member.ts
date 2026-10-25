"use client";

import { useEffect, useRef } from "react";
import { postSimulatedMemberAnswer } from "./actions";
import type { UiSnapshot } from "./types";

/**
 * While Kai, the third person of a plan for three, has a decision waiting, ask the server to have the model that plays them
 * answer it, once per plan from this page; the server answers once overall. Kai is fictional in every room, so this does not
 * wait on the simulated-friend switch. A trip's people answer through the trip engine instead. Never runs over a recording.
 */
export function useSimulatedMember(snapshot: UiSnapshot | null, onChanged: () => void, enabled = true, onPaused?: (text: string) => void) {
  const asked = useRef(new Set<string>());
  const plan = snapshot?.plan ?? null;
  const kai = plan?.group?.members.find((member) => member.id === "kai");
  const waiting = enabled && plan?.kind !== "trip" && plan?.state === "awaiting_humans" && kai?.decision === "pending";
  const planId = waiting ? plan.id : null;

  useEffect(() => {
    if (!planId || asked.current.has(planId)) return;
    asked.current.add(planId);
    void postSimulatedMemberAnswer(planId).then((result) => {
      // A failed answer may be retried the next time this plan is seen waiting; a paused budget is not retried.
      if (!result.ok && !result.paused) asked.current.delete(planId);
      if (!result.ok && result.paused) onPaused?.(result.message);
      onChanged();
    });
  }, [planId, onChanged, onPaused]);
}
