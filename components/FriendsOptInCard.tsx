"use client";

import { copy } from "@/lib/ui/copy";
import type { OnboardingAction, OnboardingState } from "@/lib/ui/onboarding";
import { CardShell, Pill } from "./CardShell";
import { NameCard } from "./NameCard";

type Props = {
  state: OnboardingState;
  dispatch: (action: OnboardingAction) => void;
};

/** Screen 1: the name, what Friends is in a line and three points, and two equal choices. Return takes the fast path. */
export function FriendsOptInCard({ state, dispatch }: Props) {
  const text = copy.onboarding;
  return (
    <CardShell label={text.nameTitle}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          dispatch({ type: "friendsOn" });
        }}
      >
        <NameCard name={state.name} onName={(name) => dispatch({ type: "name", name })} />
        <p className="mt-4 text-[15px] leading-[21px]">{text.friendsLine}</p>
        <ul className="mt-2 space-y-1.5">
          {text.friendsPoints.map((point) => (
            <li key={point} className="flex gap-2.5 text-[15px] leading-[21px]">
              <span aria-hidden="true" className="mt-[7.5px] size-1.5 shrink-0 rounded-full bg-accent-dot" />
              {point}
            </li>
          ))}
        </ul>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <Pill tone="grey" onClick={() => dispatch({ type: "notNow" })}>
            {text.notNow}
          </Pill>
          <Pill tone="accent" type="submit">
            {text.turnOn}
          </Pill>
        </div>
        <p className="mt-3 text-center text-[13px] leading-[18px] text-muted">{text.changeAnytime}</p>
      </form>
    </CardShell>
  );
}
