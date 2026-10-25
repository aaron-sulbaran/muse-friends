"use client";

import { Clock, Lock } from "lucide-react";
import type { SeededFriend } from "@/lib/seed/friends";
import type { PrivacyChange } from "@/lib/ui/actions";
import { EVENT_NAMES_LINE, FREE_TIMES_LINE, SWITCH_ROWS, TIER_LABELS } from "@/lib/ui/categories";
import { copy } from "@/lib/ui/copy";
import type { ShareTier, SharingSettings } from "@/lib/ui/types";
import { Pill } from "./CardShell";
import { FriendDiscWithMuse } from "./FriendDiscWithMuse";
import { SheetShell } from "./SheetShell";
import { SwitchRow } from "./SwitchRow";

type Props = {
  friend: SeededFriend;
  /** The tier the judge picked on screen 2 for this friend; it fills the switches and names the group in the line. */
  tier: ShareTier;
  /** The switches as they stand now: the same settings the avatar sheet edits. */
  sharing: SharingSettings;
  onChange: (change: PrivacyChange) => void;
  onBack: () => void;
  onDone: () => void;
};

/** Screen 3: what one friend's Muse can see. Four switches from the tier, any of them changeable, two fixed lines. */
export function ShareSheet({ friend, tier, sharing, onChange, onBack, onDone }: Props) {
  const text = copy.onboarding;
  return (
    <SheetShell label={text.shareTitle(friend.name)} onClose={onBack}>
      <FriendDiscWithMuse initial={friend.initial} museModel={friend.museModel} />
      <h2 className="mt-3 text-[20px] font-semibold leading-[26px]">{text.shareTitle(friend.name)}</h2>
      <p className="mt-1 text-[15px] leading-5 text-muted">{text.shareLine(friend.name, TIER_LABELS[tier])}</p>

      <ul className="mt-3 divide-y divide-bezel-line border-t border-bezel-line">
        {SWITCH_ROWS.map(({ value, label, line }) => (
          <SwitchRow key={value} label={label} line={line} checked={sharing.categories[value]} onChange={(on) => onChange({ category: value, on })} />
        ))}
      </ul>

      <ul className="mt-2 space-y-2 border-t border-bezel-line pt-3">
        <li className="flex items-start gap-2.5 text-[13px] leading-[18px] text-muted">
          <Clock className="mt-px size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          {FREE_TIMES_LINE}
        </li>
        <li className="flex items-start gap-2.5 text-[13px] leading-[18px] text-muted">
          <Lock className="mt-px size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          {EVENT_NAMES_LINE}
        </li>
      </ul>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Pill tone="grey" onClick={onBack}>
          {text.back}
        </Pill>
        <Pill tone="accent" onClick={onDone}>
          {text.done}
        </Pill>
      </div>
    </SheetShell>
  );
}
