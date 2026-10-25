"use client";

import { useId } from "react";
import { TIER_LABELS } from "@/lib/ui/categories";
import type { ShareTier } from "@/lib/ui/types";

type Props = {
  value: ShareTier;
  onChange: (tier: ShareTier) => void;
  /** The group's accessible name, e.g. who a friend is to the person. Read out, never shown. */
  label: string;
  /** Tighter padding, for a control inside every row of a list. */
  compact?: boolean;
  /** Tiers that cannot be picked right now (the avatar sheet keeps Off out of reach in the demo). */
  disabled?: (tier: ShareTier) => boolean;
};

const TIER_ORDER: ReadonlyArray<ShareTier> = ["close", "friend", "off"];

/** The three-way "Close friend, Friend, Off" control: the avatar sheet's, and one per row of the friends list. */
export function TierControl({ value, onChange, label, compact = false, disabled }: Props) {
  const group = useId();
  return (
    <fieldset>
      <legend className="sr-only">{label}</legend>
      <div className="flex gap-1 rounded-full bg-group p-1">
        {TIER_ORDER.map((tier) => (
          <label key={tier} className="flex-1">
            <input
              type="radio"
              name={group}
              value={tier}
              checked={value === tier}
              disabled={disabled?.(tier) ?? false}
              onChange={() => onChange(tier)}
              className="peer sr-only"
            />
            <span
              className={`block cursor-pointer rounded-full px-2 text-center text-[13px] font-semibold text-muted transition-colors peer-checked:bg-surface peer-checked:text-ink peer-checked:shadow-float peer-disabled:cursor-default peer-disabled:opacity-50 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${compact ? "py-1" : "py-1.5"}`}
            >
              {TIER_LABELS[tier]}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
