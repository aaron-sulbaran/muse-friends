"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { postPrivacy, type PrivacyChange } from "@/lib/ui/actions";
import { copy } from "@/lib/ui/copy";
import type { Category, ShareTier, SharingSettings } from "@/lib/ui/types";
import { MuseAvatar } from "./MuseAvatar";

type Props = {
  /** The grey-disc letter when this Muse person is a stand-in; null for the character art. */
  initial: string | null;
  /** The Muse whose sharing this is, and the friend it is shared with. */
  museName: string;
  friendMuseName: string;
  sharing: SharingSettings;
  /** Called after a change lands so the caller can refresh the snapshot at once. */
  onChanged: () => void;
  onClose: () => void;
};

const tiers: ReadonlyArray<{ value: ShareTier; label: string }> = [
  { value: "close", label: "Close friend" },
  { value: "friend", label: "Friend" },
  { value: "acquaintance", label: "Acquaintance" },
  { value: "off", label: "Off" },
];

const categories: ReadonlyArray<{ value: Category; label: string; fixedOn?: string }> = [
  { value: "food", label: "Food and places" },
  { value: "events", label: "Events" },
  { value: "availability", label: "Free times", fixedOn: "Always on: this is how the Muses find a day" },
  { value: "location", label: "Location" },
  { value: "interests", label: "Interests" },
];

/**
 * What this Muse tells its friend's Muse, one switch per category. Changing a
 * switch is checked in code on the next message and replays the propose, so
 * the withheld stamp shows up in Activity.
 */
export function AvatarSheet({ initial, museName, friendMuseName, sharing, onChanged, onClose }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  async function change(next: PrivacyChange) {
    setPending(true);
    setError(null);
    const result = await postPrivacy(next);
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
        aria-label={`${museName} sharing with ${friendMuseName}`}
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
              <MuseAvatar agent="lisa" initial={initial} name={museName} size={40} />
              <div>
                <p className="text-[15px] font-semibold leading-5">{museName}</p>
                <p className="text-[13px] leading-[18px] text-muted">Sharing with {friendMuseName}</p>
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

        <fieldset className="mt-5">
          <legend className="sr-only">Who {friendMuseName} is to {museName}</legend>
          <div className="flex gap-1 rounded-full bg-group p-1">
            {tiers.filter(({ value }) => value !== "acquaintance" || sharing.tier === "acquaintance").map(({ value, label }) => (
              <label key={value} className="flex-1">
                <input
                  type="radio"
                  name="tier"
                  value={value}
                  checked={sharing.tier === value}
                  disabled={pending || value === "off" || value === "acquaintance"}
                  onChange={() => change({ tier: value })}
                  className="peer sr-only"
                />
                <span className="block cursor-pointer rounded-full px-2 py-1.5 text-center text-[13px] font-semibold text-muted transition-colors peer-checked:bg-surface peer-checked:text-ink peer-checked:shadow-float peer-disabled:cursor-default peer-disabled:opacity-50 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent">
                  {label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <ul className="mt-3 divide-y divide-bezel-line">
          {categories.map(({ value, label, fixedOn }) => (
            <li key={value}>
              <label className="flex items-center justify-between gap-4 py-3">
                <span>
                  <span className="block text-[16px] leading-[22px]">{label}</span>
                  {fixedOn ? <span className="block text-[12px] leading-4 text-muted">{fixedOn}</span> : null}
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={sharing.categories[value]}
                  disabled={pending || fixedOn !== undefined}
                  onChange={(event) => change({ category: value, on: event.target.checked })}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className="relative h-7 w-12 shrink-0 cursor-pointer rounded-full bg-faint transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-6 after:rounded-full after:bg-surface after:shadow-float after:transition-transform peer-checked:bg-tracking peer-checked:after:translate-x-5 peer-disabled:cursor-default peer-disabled:opacity-60 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
                />
              </label>
            </li>
          ))}
        </ul>

        {error ? (
          <p role="alert" className="mt-3 text-[13px] leading-[18px] text-withheld">
            {error}
          </p>
        ) : null}
        <p className="mt-4 text-[13px] leading-[18px] text-muted">
          {museName} only tells {friendMuseName} what&apos;s switched on. This is checked in code before anything is sent.
        </p>
      </section>
    </div>
  );
}
