"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { copy } from "@/lib/ui/copy";
import { HOLD_MS, holdProgress } from "@/lib/ui/payment-card";

type Props = {
  amount: string;
  friend: string;
  disabled?: boolean;
  /** Called once, when the pill is full (or on the second tap with reduced motion). */
  onConfirm: () => void;
};

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(notify: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

/**
 * The one deliberate step. Pressing and holding fills the pill over 0.8 seconds and sends only when it is full; letting
 * go early empties it and nothing happens. Holding Enter or Space works the same. With reduced motion the pill is a
 * plain "Send" and a tap opens a one-line confirm, so two taps replace the hold. A single tap never sends.
 */
export function HoldToConfirm({ amount, friend, disabled = false, onConfirm }: Props) {
  const reduced = useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
  const [progress, setProgress] = useState(0);
  const [asking, setAsking] = useState(false);
  const startedAt = useRef<number | null>(null);
  const frame = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // The animation frames only draw the fill; the send itself is a timer, so it fires at 0.8 seconds of holding whatever the frame rate.
  function tick() {
    if (startedAt.current === null) return;
    setProgress(holdProgress(performance.now() - startedAt.current));
    frame.current = requestAnimationFrame(tick);
  }

  function complete() {
    if (startedAt.current === null || fired.current) return;
    fired.current = true;
    cancelAnimationFrame(frame.current);
    setProgress(1);
    onConfirm();
  }

  function begin() {
    if (disabled || startedAt.current !== null) return;
    fired.current = false;
    startedAt.current = performance.now();
    frame.current = requestAnimationFrame(tick);
    timer.current = setTimeout(complete, HOLD_MS);
  }

  function release() {
    cancelAnimationFrame(frame.current);
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    startedAt.current = null;
    if (!fired.current) setProgress(0);
  }

  if (reduced) {
    return asking ? (
      <div className="flex flex-col gap-2.5">
        <p className="text-center text-[15px] font-semibold leading-5">{copy.confirmAsk(amount, friend)}</p>
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" disabled={disabled} onClick={() => setAsking(false)} className="rounded-full bg-group px-4 py-3 text-[15px] font-semibold transition-colors hover:bg-bubble-muse disabled:opacity-50">
            {copy.confirmCancel}
          </button>
          <button type="button" disabled={disabled} onClick={onConfirm} className="rounded-full bg-accent px-4 py-3 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:opacity-50">
            {copy.confirmSend}
          </button>
        </div>
      </div>
    ) : (
      <button type="button" disabled={disabled} onClick={() => setAsking(true)} className="w-full rounded-full bg-accent px-4 py-3.5 text-[16px] font-semibold text-white transition-[filter] hover:brightness-110 disabled:opacity-50">
        {copy.confirmTap(amount)}
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        disabled={disabled}
        aria-label={copy.confirmHold(amount)}
        aria-describedby="hold-hint"
        onPointerDown={(event) => {
          // Keeps the press alive if the finger drifts off the pill; a touch or pen that cannot be captured still holds.
          try {
            event.currentTarget.setPointerCapture(event.pointerId);
          } catch {
            /* nothing to capture */
          }
          begin();
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onKeyDown={(event) => {
          if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
            event.preventDefault();
            begin();
          }
        }}
        onKeyUp={release}
        onBlur={release}
        onContextMenu={(event) => event.preventDefault()}
        style={{ touchAction: "none" }}
        className="relative w-full select-none overflow-hidden rounded-full bg-accent px-4 py-3.5 text-[16px] font-semibold text-white disabled:opacity-50"
      >
        {/* The fill rises in the pressed blue; the label stays white at every level. */}
        <span aria-hidden="true" className="absolute inset-y-0 left-0 bg-[#0a47a3]" style={{ width: `${progress * 100}%`, transition: progress === 0 ? `width ${HOLD_MS / 4}ms ease-out` : "none" }} />
        <span className="relative">{copy.confirmHold(amount)}</span>
      </button>
      <p id="hold-hint" className="sr-only">
        {copy.confirmHint}
      </p>
    </div>
  );
}
