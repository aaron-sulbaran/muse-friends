"use client";

import { useCallback, useSyncExternalStore } from "react";
import { dispatchOnboarding, readOnboarding, serverOnboarding, subscribeOnboarding } from "./onboarding-store";
import type { OnboardingAction, OnboardingState } from "./onboarding";
import type { Role } from "./types";

/** The room's onboarding state for a side and a dispatch for it, kept across a reload on the same room. */
export function useOnboarding(room: string, role: Role = "a"): readonly [OnboardingState, (action: OnboardingAction) => void] {
  const state = useSyncExternalStore(subscribeOnboarding, () => readOnboarding(room, role), () => serverOnboarding);
  const dispatch = useCallback((action: OnboardingAction) => dispatchOnboarding(room, action, role), [room, role]);
  return [state, dispatch] as const;
}
