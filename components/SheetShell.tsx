"use client";

import { useEffect, useRef } from "react";

type Props = {
  /** The dialog's accessible name. */
  label: string;
  /** Escape and a tap outside the sheet. The caller decides what leaving means. */
  onClose: () => void;
  children: React.ReactNode;
};

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * The bottom sheet every onboarding step opens in: a handle, a dimmed phone behind it, focus kept inside while it is
 * open, Escape to leave. Same container the avatar and invite sheets use, with the focus trap they do without.
 */
export function SheetShell({ label, onClose, children }: Props) {
  const sheet = useRef<HTMLElement>(null);

  useEffect(() => {
    sheet.current?.focus();
  }, []);

  function keepFocusInside(event: React.KeyboardEvent) {
    if (event.key === "Escape") return onClose();
    if (event.key !== "Tab" || !sheet.current) return;
    const stops = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (stops.length === 0) return event.preventDefault();
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === sheet.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-end bg-black/20"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={keepFocusInside}
    >
      <section
        ref={sheet}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="max-h-[88%] w-full animate-card-in overflow-y-auto rounded-t-card bg-surface px-5 pb-8 pt-3 shadow-float outline-none"
      >
        <div aria-hidden="true" className="mx-auto mb-4 h-1 w-9 rounded-full bg-grey-disc" />
        {children}
      </section>
    </div>
  );
}
