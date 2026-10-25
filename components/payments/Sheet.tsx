"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { copy } from "@/lib/ui/copy";

type Props = {
  label: string;
  onClose: () => void;
  children: React.ReactNode;
};

/**
 * A bottom sheet for the payment steps. A modal dialog, so it traps focus, closes on Escape and on a tap outside it, and
 * sits above the stage's scaled phones; on a phone it is the width of the screen.
 */
export function Sheet({ label, onClose, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-label={label}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      className="m-0 mx-auto mt-auto max-h-[88dvh] w-full max-w-[440px] animate-card-in overflow-y-auto rounded-b-none rounded-t-card bg-surface p-5 pb-8 text-ink shadow-float backdrop:bg-black/10"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label={copy.drawerClose}
        className="absolute right-4 top-4 grid size-9 place-items-center rounded-full bg-group transition-colors hover:bg-bubble-muse"
      >
        <X className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
      </button>
      {children}
    </dialog>
  );
}
