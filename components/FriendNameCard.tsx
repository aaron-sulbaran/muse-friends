"use client";

import { onboardingCopy } from "@/lib/ui/copy";
import type { OnboardingAction, OnboardingState } from "@/lib/ui/onboarding";
import { CardShell, Pill } from "./CardShell";
import { NameCard } from "./NameCard";

type Props = {
  state: OnboardingState;
  dispatch: (action: OnboardingAction) => void;
};

/** The invited phone's first screen: just a name. Return or Next goes on to when the person is free. */
export function FriendNameCard({ state, dispatch }: Props) {
  return (
    <CardShell label={onboardingCopy.nameTitle}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          dispatch({ type: "free" });
        }}
      >
        <NameCard name={state.name} onName={(name) => dispatch({ type: "name", name })} />
        <div className="mt-4">
          <Pill tone="accent" type="submit" className="w-full">
            {onboardingCopy.nameNext}
          </Pill>
        </div>
      </form>
    </CardShell>
  );
}
