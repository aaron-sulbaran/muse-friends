"use client";

import { HandCoins, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { postSettle } from "@/lib/ui/actions";
import { copy } from "@/lib/ui/copy";
import { settleDetailFor, type SettleOffer } from "@/lib/ui/payments";
import type { Role } from "@/lib/ui/types";
import { Elapsed } from "./Elapsed";

type Props = {
  planId: string;
  role: Role;
  offer: Extract<SettleOffer, { kind: "turn_on" | "ready" }>;
  friendName: string;
  friendMuse: string;
  /** This person's own Muse, named where the card says who works the amount out. */
  museName: string;
  /** How many payments the room has now: a new one ends the wait. */
  paymentCount: number;
  /** A recording is on screen: show the card, but asking for money would touch live state. */
  readOnly: boolean;
  onChanged: () => void;
  /** The live-run caps are reached: the page falls back to a recording. */
  onPaused?: (text: string) => void;
  /** Opens this seat's payments settings, for the off state. */
  onOpenSettings: () => void;
  /** Draw the card already waiting on the Muse, or already timed out, for a card drawn after the fact. */
  initiallyWorking?: boolean;
  initiallyStalled?: boolean;
};

/**
 * After a confirmed plan: ask your Muse to settle up. The Muse decides whether money moves and how much, within
 * the cap you set; the friend's Muse accepts it or sends it back. Off until the person turns payments on. The card
 * is the friend's Muse asking for her half after the event, in the receipt's own words. The Muse prepares an amount and
 * the person confirms it on the payment card (D28); nothing moves before that.
 */
export function SettleCard({ planId, role, offer, friendName, friendMuse, museName, paymentCount, readOnly, onChanged, onPaused, onOpenSettings, initiallyWorking = false, initiallyStalled = false }: Props) {
  const [note, setNote] = useState("");
  const [working, setWorking] = useState(initiallyWorking);
  const [stalled, setStalled] = useState(initiallyStalled);
  const [error, setError] = useState<string | null>(null);
  const [countAtStart, setCountAtStart] = useState(paymentCount);

  // A new payment ends the wait, and so does a minute with none: the model has had its say either way.
  const waiting = working && paymentCount <= countAtStart;
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => {
      setWorking(false);
      setStalled(true);
    }, 60_000);
    return () => clearTimeout(timer);
  }, [waiting]);

  async function settle() {
    if (readOnly) return;
    setError(null);
    setStalled(false);
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
          <h3 className="text-[17px] font-semibold leading-[22px]">{copy.settleTitle(friendName)}</h3>
          <p className="mt-0.5 text-[13px] leading-[18px] text-muted">{settleDetailFor({ kind: offer.kind, place: offer.place, friendMuse, museName })}</p>
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
          {waiting ? (
            // The Muse is working: say with whom and for how long, so the card never looks frozen.
            <p role="status" className="mt-2.5 flex items-center justify-center gap-2 text-[13px] leading-[18px] text-muted">
              <LoaderCircle className="size-4 animate-spin" strokeWidth={2} aria-hidden="true" />
              <span>
                {copy.settleWorkingWith(friendMuse)}, <Elapsed />
              </span>
            </p>
          ) : stalled ? (
            <p role="status" className="mt-2.5 text-center text-[13px] leading-[18px] text-muted">
              {copy.settleStalled}
            </p>
          ) : null}
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
