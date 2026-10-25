"use client";

import { useEffect, useRef, useState } from "react";
import { copy } from "@/lib/ui/copy";
import { formatTime } from "@/lib/ui/format";
import type { Moment, MomentKey } from "@/lib/ui/moments";

type Props = {
  moments: Moment[];
  /** Scrolls the conversation to a moment. The button shows only when something can do that. */
  onShow?: (key: MomentKey) => void;
  /** Opens one card on first render, for a header drawn after the fact. */
  initiallyOpen?: MomentKey;
};

/**
 * The three moments that replace the Follow-through counter: pills that light up as the plan moves. Each opens a
 * card saying what the moment means and when it happened. Colour is never the only signal: the pill's label says
 * whether it was reached.
 */
export function MomentChips({ moments, onShow, initiallyOpen }: Props) {
  const [open, setOpen] = useState<MomentKey | null>(initiallyOpen ?? null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(null);
        return;
      }
      if (root.current && !root.current.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const shown = moments.find((moment) => moment.key === open) ?? null;

  return (
    <div ref={root} className="relative flex gap-1.5">
      {moments.map((moment) => {
        const reached = moment.reachedAt !== null;
        return (
          <button
            key={moment.key}
            type="button"
            onClick={() => setOpen((current) => (current === moment.key ? null : moment.key))}
            aria-expanded={open === moment.key}
            aria-controls="moment-card"
            aria-label={`${moment.label}, ${reached ? "reached" : "not yet"}`}
            className={`flex h-7 items-center gap-1.5 rounded-full px-[11px] text-[12px] font-semibold leading-4 transition-colors ${
              reached ? "bg-[#E6F5EC] text-tracking" : "bg-group text-muted hover:bg-bubble-muse"
            }`}
          >
            <span key={reached ? "on" : "off"} aria-hidden="true" className={`size-1.5 rounded-full ${reached ? "animate-pop bg-tracking" : "bg-[#C7C8CC]"}`} />
            {moment.label}
          </button>
        );
      })}
      {shown ? (
        <div
          id="moment-card"
          role="dialog"
          aria-label={shown.label}
          className="absolute right-0 top-full z-20 mt-2 w-[300px] animate-pop-in rounded-[16px] bg-surface p-4 shadow-[0_6px_24px_rgba(0,0,0,0.12)]"
        >
          <p className="text-[14px] font-semibold leading-5">{shown.label}</p>
          <p className="mt-1 text-[13px] leading-[18px] text-muted">{shown.line}</p>
          <p className="mt-2 text-[12px] leading-4 text-muted">{shown.reachedAt ? formatTime(shown.reachedAt) : copy.momentNotYet}</p>
          {onShow ? (
            <button type="button" onClick={() => onShow(shown.key)} className="mt-2 text-[13px] font-semibold leading-[18px] text-accent-dot hover:underline">
              {copy.momentShow}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
