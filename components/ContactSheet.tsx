"use client";

import { UserCheck, UserMinus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { postFollowUp } from "@/lib/ui/actions";
import { copy } from "@/lib/ui/copy";
import { followMark, tierLabel } from "@/lib/ui/contacts";
import type { UiContact } from "@/lib/ui/types";

type Props = {
  contacts: UiContact[];
  museName: string;
  /** Called after a pick so the caller can refresh the snapshot at once. */
  onChanged: () => void;
  /** The live-run caps are reached: the page falls back to a recording instead of showing an error. */
  onPaused?: (text: string) => void;
  onClose: () => void;
};

/**
 * "Follow up with someone you met." The person picks; the code decides whether
 * the Muse may reach out. A contact who does not follow back can still be picked,
 * so the gate's refusal is visible rather than hidden by the list.
 */
export function ContactSheet({ contacts, museName, onChanged, onPaused, onClose }: Props) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  async function pick(contact: UiContact) {
    setPending(contact.id);
    setError(null);
    const result = await postFollowUp(contact.id);
    setPending(null);
    onChanged();
    // A refusal is the gate working, not a failure: the timeline and the phone show it, so the sheet just closes.
    // So does a paused budget: the page plays a recording and says why.
    if (!result.ok && result.paused) onPaused?.(result.message);
    if (result.ok || result.refused || result.paused) onClose();
    else setError(result.message);
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
        aria-label={copy.contactEntry}
        className="max-h-[88%] w-full animate-card-in overflow-y-auto rounded-t-card bg-surface px-5 pb-8 pt-5 shadow-float"
      >
        <header className="flex items-start justify-between gap-3">
          <h2 className="text-[17px] font-semibold leading-[22px]">{copy.contactSheetTitle}</h2>
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

        <ul className="mt-3 divide-y divide-bezel-line">
          {contacts.map((contact) => {
            const Mark = contact.mutualFollow ? UserCheck : UserMinus;
            return (
              <li key={contact.id}>
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => pick(contact)}
                  className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-group disabled:opacity-60"
                >
                  <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-group text-[15px] font-semibold">
                    {contact.name.charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[15px] font-semibold leading-5">{contact.name}</span>
                      <span className="rounded-full bg-group px-2 py-0.5 text-[12px] leading-4">{tierLabel[contact.tier]}</span>
                    </span>
                    <span className="block text-[13px] leading-[18px] text-muted">{contact.note}</span>
                    <span className={`mt-0.5 flex items-center gap-1.5 text-[12px] leading-4 ${contact.mutualFollow ? "text-tracking" : "text-muted"}`}>
                      <Mark className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
                      {followMark(contact)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {error ? (
          <p role="alert" className="mt-3 text-[13px] leading-[18px] text-withheld">
            {error}
          </p>
        ) : null}
        <p className="mt-4 text-[13px] leading-[18px] text-muted">{copy.contactSheetNote(museName)}</p>
      </section>
    </div>
  );
}
