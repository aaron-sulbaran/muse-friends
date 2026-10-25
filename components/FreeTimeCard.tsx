"use client";

import { freeChips } from "@/lib/ui/free-windows";
import { onboardingCopy } from "@/lib/ui/copy";
import type { OnboardingAction, OnboardingState } from "@/lib/ui/onboarding";
import { CardShell, Pill } from "./CardShell";

type Props = {
  state: OnboardingState;
  /** The room's clock: the chips are the times still ahead inside the week from here. */
  nowIso: string;
  dispatch: (action: OnboardingAction) => void;
  /** Side a may skip it (the seeded week stands); side b needs at least one time to have any. */
  onSkip?: () => void;
  onDone: () => void;
  saving: boolean;
  /** What the server or the check said about the answers, plainly. */
  error: string | null;
};

const fieldClass = "mt-2 w-full rounded-[14px] bg-group px-4 py-3 text-[16px] leading-[22px] placeholder:text-faint";

/**
 * "When are you free this week?" as tappable times, a line to type one, and one line on what you feel like doing, with the
 * sandbox line under it. It asks for what the sandbox cannot know: your Muse here has no calendar of yours to read.
 */
export function FreeTimeCard({ state, nowIso, dispatch, onSkip, onDone, saving, error }: Props) {
  const text = onboardingCopy;
  const chips = freeChips(nowIso);
  return (
    <CardShell label={text.freeTitle}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!saving) onDone();
        }}
      >
        <h3 className="text-[17px] font-semibold leading-[22px]">{text.freeTitle}</h3>
        <p className="mt-0.5 text-[13px] leading-[18px] text-muted">{text.freeLine}</p>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={text.freeTitle}>
          {chips.map((chip) => {
            const on = state.free.chips.includes(chip.id);
            return (
              <button
                key={chip.id}
                type="button"
                aria-pressed={on}
                onClick={() => dispatch({ type: "chip", id: chip.id })}
                className={`rounded-full px-3.5 py-2 text-[15px] font-semibold transition-colors ${on ? "bg-accent-dot text-white" : "bg-group text-ink hover:bg-bubble-muse"}`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
        <input
          type="text"
          value={state.free.text}
          onChange={(event) => dispatch({ type: "freeText", text: event.target.value })}
          aria-label={text.freeTextLabel}
          placeholder={text.freeTextPlaceholder}
          autoComplete="off"
          enterKeyHint="next"
          className={fieldClass}
        />
        <h3 className="mt-4 text-[17px] font-semibold leading-[22px]">
          {text.feelsTitle} <span className="text-[13px] font-normal text-muted">{text.feelsOptional}</span>
        </h3>
        <input
          type="text"
          value={state.free.feels}
          onChange={(event) => dispatch({ type: "feels", text: event.target.value })}
          aria-label={text.feelsTitle}
          placeholder={text.feelsPlaceholder}
          autoComplete="off"
          enterKeyHint="done"
          maxLength={120}
          className={fieldClass}
        />
        <p className="mt-3 text-[13px] leading-[18px] text-muted">{text.sandboxLine}</p>
        {error ? (
          <p role="alert" className="mt-2 text-[13px] leading-[18px] text-withheld">
            {error}
          </p>
        ) : null}
        <div className={`mt-4 grid gap-2.5 ${onSkip ? "grid-cols-2" : "grid-cols-1"}`}>
          {onSkip ? (
            <Pill tone="grey" disabled={saving} onClick={onSkip}>
              {text.skipFree}
            </Pill>
          ) : null}
          <Pill tone="accent" type="submit" disabled={saving}>
            {saving ? text.freeSaving : text.done}
          </Pill>
        </div>
      </form>
    </CardShell>
  );
}
