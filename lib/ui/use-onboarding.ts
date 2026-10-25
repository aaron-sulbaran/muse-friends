"use client";

import { useCallback, useSyncExternalStore } from "react";
import { dispatchOnboarding, readOnboarding, serverOnboarding, subscribeOnboarding } from "./onboarding-store";
import type { OnboardingAction, OnboardingState } from "./onboarding";

/** The room's onboarding state and a dispatch for it, kept across a reload on the same room. */
export function useOnboarding(room: string): readonly [OnboardingState, (action: OnboardingAction) => void] {
  const state = useSyncExternalStore(subscribeOnboarding, () => readOnboarding(room), () => serverOnboarding);
  const dispatch = useCallback((action: OnboardingAction) => dispatchOnboarding(room, action), [room]);
  return [state, dispatch] as const;
}
