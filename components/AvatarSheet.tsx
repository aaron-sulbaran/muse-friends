"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { postPrivacy, type PrivacyChange } from "@/lib/ui/actions";
import { copy } from "@/lib/ui/copy";
import { SWITCH_ROWS } from "@/lib/ui/categories";
import type { PaymentsSettings, Role, SharingSettings } from "@/lib/ui/types";
import { MuseAvatar } from "./MuseAvatar";
import { PaymentsSection } from "./PaymentsSection";
import { SwitchRow } from "./SwitchRow";
import { TierControl } from "./TierControl";

type Props = {
  /** Which phone this sheet is on: side b has the sharing switches, and either side has its payments. */
  role: Role;
  /** The Muse whose sharing this is, and the friend it is shared with. */
  museName: string;
  friendMuseName: string;
  /** What this Muse tells its friend's Muse; omitted on side a, whose sheet holds only its payments. */
  sharing?: SharingSettings;
  /** What this seat lets its Muse send; omitted when payments are switched off for the room. */
  payments?: PaymentsSettings;
  /** On a phone with no Activity panel beside it, a way to open Activity from here. */
  onOpenActivity?: () => void;
  /** Called after a change lands so the caller can refresh the snapshot at once. */
  onChanged: () => void;
  onClose: () => void;
};

/** The avatar sheet keeps Free times as a locked-on row; the onboarding's share sheet states it as a line instead. */
const FREE_TIMES = { label: "Free times", line: "Always included: open windows only, never what is in them" };

/**
 * What this Muse tells its friend's Muse, one switch per category. Changing a
 * switch is checked in code on the next message and replays the propose, so
 * the withheld stamp shows up in Activity.
 */
export function AvatarSheet({ role, museName, friendMuseName, sharing, payments, onOpenActivity, onChanged, onClose }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  async function change(next: PrivacyChange) {
    setPending(true);
    setError(null);
    const result = await postPrivacy(next, role);
    setPending(false);
    if (!result.ok) setError(result.message);
    onChanged();
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-end bg-black/10"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={sharing ? `${museName} sharing with ${friendMuseName}` : `${museName} payments`}
        className="max-h-[88%] w-full animate-card-in overflow-y-auto rounded-t-card bg-surface px-5 pb-8 pt-5 shadow-float"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2>
              {/* The wordmark names the feature where its settings live. A fixed vector asset from the brand kit. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/wordmark/muse-friends-wordmark.svg" alt="Muse Friends" className="h-[22px] w-auto" />
            </h2>
            <div className="mt-3 flex items-center gap-3">
              <MuseAvatar agent={role === "a" ? "aaron" : "lisa"} name={museName} size={40} />
              <div>
                <p className="text-[15px] font-semibold leading-5">{museName}</p>
                <p className="text-[13px] leading-[18px] text-muted">{sharing ? `Sharing with ${friendMuseName}` : copy.paymentsSection}</p>
              </div>
            </div>
          </div>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label={copy.drawerClose}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-group transition-colors hover:bg-bubble-muse"
          >
            <X className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>

        {sharing ? (
          <>
            <div className="mt-5">
              <TierControl
                value={sharing.tier}
                onChange={(tier) => change({ tier })}
                label={`Who ${friendMuseName} is to ${museName}`}
                disabled={(tier) => pending || tier === "off" || tier === "acquaintance"}
              />
            </div>

            <ul className="mt-3 divide-y divide-bezel-line">
              {SWITCH_ROWS.map(({ value, label, line }) => (
                <SwitchRow
                  key={value}
                  label={label}
                  line={line}
                  checked={sharing.categories[value]}
                  disabled={pending}
                  onChange={(on) => change({ category: value, on })}
                />
              ))}
              <SwitchRow label={FREE_TIMES.label} line={FREE_TIMES.line} checked={sharing.categories.availability} disabled />
            </ul>
          </>
        ) : null}

        {payments ? <PaymentsSection role={role} settings={payments} onChanged={onChanged} /> : null}

        {error ? (
          <p role="alert" className="mt-3 text-[13px] leading-[18px] text-withheld">
            {error}
          </p>
        ) : null}
        {sharing ? (
          <p className="mt-4 text-[13px] leading-[18px] text-muted">
            {museName} only tells {friendMuseName} what&apos;s switched on. This is checked in code before anything is sent.
          </p>
        ) : null}
        {onOpenActivity ? (
          <button
            type="button"
            onClick={onOpenActivity}
            className="mt-4 w-full rounded-full bg-group px-4 py-2.5 text-[15px] font-semibold transition-colors hover:bg-bubble-muse"
          >
            {copy.activityOpen}
          </button>
        ) : null}
      </section>
    </div>
  );
}
