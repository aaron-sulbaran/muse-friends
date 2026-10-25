"use client";

import { HandCoins } from "lucide-react";
import { useEffect, useState } from "react";
import { postSettle } from "@/lib/ui/actions";
import { copy } from "@/lib/ui/copy";
import { proposalSentence, settleDetailFor, type SettleOffer, type SplitFacts } from "@/lib/ui/payments";
import type { Role } from "@/lib/ui/types";

type Props = {
  planId: string;
  role: Role;
  offer: Extract<SettleOffer, { kind: "turn_on" | "ready" }>;
  friendName: string;
  friendMuse: string;
  /** How many payments the room has now: a new one ends the wait. */
  paymentCount: number;
  /** A recording is on screen: show the card, but asking for money would touch live state. */
  readOnly: boolean;
  onChanged: () => void;
  /** The live-run caps are reached: the page falls back to a recording. */
  onPaused?: (text: string) => void;
  /** Opens this seat's payments settings, for the off state. */
  onOpenSettings: () => void;
  /** An amount the friend's Muse is asking for, once the agents propose one: the card then names it, the reason and the split. */
  proposal?: { amount: number; reason: string; breakdown?: SplitFacts };
};

/**
 * After a confirmed plan: ask your Muse to settle up. The Muse decides whether money moves and how much, within
 * the cap you set; the friend's Muse accepts it or sends it back. Off until the person turns payments on. The card
 * says what is being settled (the plan's event and day) and the cap; once an amount is proposed it names that too.
 */
export function SettleCard({ planId, role, offer, friendName, friendMuse, paymentCount, readOnly, onChanged, onPaused, onOpenSettings, proposal }: Props) {
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countAtStart, setCountAtStart] = useState(paymentCount);

  // A new payment ends the wait, and so does a minute with none: the model has had its say either way.
  const waiting = working && paymentCount <= countAtStart;
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setWorking(false), 60_000);
    return () => clearTimeout(timer);
  }, [waiting]);

  async function settle() {
    if (readOnly) return;
    setError(null);
    setCountAtStart(paymentCount);
    setWorking(true);
    const result = await postSettle(planId, role, note.trim() || undefined);
    if (!result.ok) {
      setWorking(false);
      if (result.paused) onPaused?.(result.message);
      else setError(result.message);
    }
    onChanged();
  }

  const off = offer.kind === "turn_on";
  return (
    <section className="max-w-[92%] animate-card-in rounded-card bg-surface p-5 shadow-float">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-tile bg-group">
          <HandCoins className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[17px] font-semibold leading-[22px]">{off ? copy.settleOffTitle : copy.settleTitle(friendName)}</h3>
          <p className="mt-0.5 text-[13px] leading-[18px] text-muted">
            {off
              ? copy.settleOffDetail
              : proposal
                ? proposalSentence({ friend: friendName, cap: offer.cap, ...proposal })
                : settleDetailFor({ cap: offer.cap, event: offer.event, friendMuse })}
          </p>
        </div>
      </div>
      {off ? (
        <button
          type="button"
          disabled={readOnly}
          onClick={onOpenSettings}
          className="mt-4 w-full rounded-full bg-group px-4 py-2.5 text-[15px] font-semibold transition-colors hover:bg-bubble-muse disabled:opacity-50"
        >
          {copy.settleOffAction}
        </button>
      ) : (
        <>
          <input
            type="text"
            value={note}
            maxLength={200}
            disabled={waiting || readOnly}
            onChange={(event) => setNote(event.target.value)}
            placeholder={copy.settleNotePlaceholder}
            aria-label={copy.settleNoteLabel}
            className="mt-4 w-full truncate rounded-full bg-group px-4 py-2.5 text-[15px] leading-5 outline-none placeholder:text-faint focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
          />
          <button
            type="button"
            disabled={waiting || readOnly}
            onClick={settle}
            className="mt-2.5 w-full rounded-full bg-accent px-4 py-2.5 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 active:brightness-90 disabled:opacity-50"
          >
            {waiting ? copy.settleWorking : copy.settleAction}
          </button>
        </>
      )}
      {error ? (
        <p role="alert" className="mt-3 text-[13px] leading-[18px] text-withheld">
          {error}
        </p>
      ) : null}
    </section>
  );
}
