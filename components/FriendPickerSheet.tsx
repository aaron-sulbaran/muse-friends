"use client";

import { ChevronRight, Users } from "lucide-react";
import { SEEDED_FRIENDS, type SeededFriend } from "@/lib/seed/friends";
import { onboardingCopy } from "@/lib/ui/copy";
import type { OnboardingAction, OnboardingState } from "@/lib/ui/onboarding";
import type { ShareTier } from "@/lib/ui/types";
import { Pill } from "./CardShell";
import { PersonDisc } from "./PersonDisc";
import { SheetShell } from "./SheetShell";
import { TierControl } from "./TierControl";

type Props = {
  /** 2a the choice, 2b the synced Close Friends list, 2c the pick list. */
  mode: "choose" | "synced" | "pick";
  state: OnboardingState;
  dispatch: (action: OnboardingAction) => void;
  /** Escape or a tap outside the sheet. */
  onClose: () => void;
};

const text = onboardingCopy;

/** Instagram's glyph, drawn here because the icon set has no brand marks. */
function InstagramGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17" cy="7" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ChoiceRow({ icon, title, line, onChoose }: { icon: React.ReactNode; title: string; line: string; onChoose: () => void }) {
  return (
    <button
      type="button"
      onClick={onChoose}
      className="flex w-full items-center gap-4 rounded-group bg-group p-4 text-left transition-colors hover:bg-bubble-muse active:bg-bubble-muse"
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-tile bg-surface text-ink">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-semibold leading-[22px]">{title}</span>
        <span className="mt-0.5 block text-[15px] leading-5 text-muted">{line}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-faint" strokeWidth={1.75} aria-hidden="true" />
    </button>
  );
}

/** A synced person is on the judge's own Instagram list; the demo's reel sender also says so. */
function syncedFact(friend: SeededFriend): string {
  if (!friend.onInstagramCloseFriends) return friend.fact;
  return friend.fact === text.onCloseFriends ? `${text.onCloseFriends}.` : `${text.onCloseFriends}. ${friend.fact}.`;
}

function FriendRow({ friend, fact, tier, onTier }: { friend: SeededFriend; fact: string; tier: ShareTier; onTier: (tier: ShareTier) => void }) {
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <PersonDisc name={friend.name} size={40} />
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-5">{friend.name}</p>
          <p className="text-[13px] leading-[18px] text-muted">{fact}</p>
        </div>
      </div>
      <div className="mt-2">
        <TierControl value={tier} onChange={onTier} label={text.whoOf(friend.name)} compact />
      </div>
    </li>
  );
}

/** Screen 2: who can the Muse talk to. Sync brings in a seeded list; Pick starts every row at Off. Nobody is pre-selected. */
export function FriendPickerSheet({ mode, state, dispatch, onClose }: Props) {
  const synced = mode === "synced";
  const title = synced ? text.syncedTitle : text.whoTitle;
  return (
    <SheetShell label={title} onClose={onClose}>
      <div className="flex items-center gap-2.5">
        <h2 className="text-[20px] font-semibold leading-[26px]">{title}</h2>
        {synced ? <span className="rounded-full bg-group px-2.5 py-0.5 text-[12px] font-semibold leading-4 text-muted">{text.seededChip}</span> : null}
      </div>
      <p className="mt-1 text-[15px] leading-5 text-muted">{synced ? text.syncedLine : text.whoLine}</p>

      {mode === "choose" ? (
        <div className="mt-4 space-y-2.5">
          <ChoiceRow icon={<InstagramGlyph />} title={text.syncTitle} line={text.syncLine} onChoose={() => dispatch({ type: "sync" })} />
          <ChoiceRow
            icon={<Users className="size-5" strokeWidth={1.75} aria-hidden="true" />}
            title={text.pickTitle}
            line={text.pickLine}
            onChoose={() => dispatch({ type: "pick" })}
          />
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-bezel-line border-t border-bezel-line">
          {SEEDED_FRIENDS.map((friend) => (
            <FriendRow
              key={friend.id}
              friend={friend}
              fact={synced ? syncedFact(friend) : friend.fact}
              tier={state.tiers[friend.id] ?? "off"}
              onTier={(tier) => dispatch({ type: "tier", friendId: friend.id, tier })}
            />
          ))}
        </ul>
      )}

      <p className="mt-4 text-[15px] leading-5 text-muted">{text.notTold}</p>

      {mode === "choose" ? (
        <Pill tone="grey" onClick={() => dispatch({ type: "notNow" })} className="mt-4 w-full">
          {text.notNow}
        </Pill>
      ) : (
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {synced ? (
            <Pill tone="grey" onClick={() => dispatch({ type: "back" })}>
              {text.back}
            </Pill>
          ) : (
            <Pill tone="grey" onClick={() => dispatch({ type: "notNow" })}>
              {text.notNow}
            </Pill>
          )}
          <Pill tone="accent" onClick={() => dispatch({ type: "continue" })}>
            {text.continue}
          </Pill>
        </div>
      )}
    </SheetShell>
  );
}
