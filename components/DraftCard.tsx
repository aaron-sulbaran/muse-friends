"use client";

import { useEffect, useState } from "react";
import { copy } from "@/lib/ui/copy";
import { whatsAppUrl } from "@/lib/ui/handoff";
import { CheckMark } from "./CheckMark";
import { WhatsAppGlyph } from "./marks/WhatsAppGlyph";

type Props = {
  draft: string;
  /** Called when the person takes the draft away, by either route. */
  onHandoff: (via: "whatsapp" | "copy") => void;
  /** WhatsApp was already opened, for a card drawn after the fact. */
  initiallyOpened?: boolean;
};

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The drafted message and the handoff. The agent drafts; the person opens
 * WhatsApp, picks the contact, and presses send. Copy is the fallback when the
 * link does not open. Once WhatsApp was opened the card collapses: Copy and the
 * Open button go, and one secondary button, Continue this conversation in
 * WhatsApp, reopens the same link.
 */
export function DraftCard({ draft, onHandoff, initiallyOpened = false }: Props) {
  const [copied, setCopied] = useState(false);
  const [opened, setOpened] = useState(initiallyOpened);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function handleCopy() {
    if (await copyToClipboard(draft)) {
      setCopied(true);
      onHandoff("copy");
    }
  }

  const link = whatsAppUrl(draft);
  const open = () => {
    setOpened(true);
    onHandoff("whatsapp");
  };

  return (
    <section aria-label="Draft message" className="max-w-[92%] animate-card-in rounded-card bg-surface p-4 shadow-float">
      <p className="rounded-group bg-group px-3.5 py-3 text-[16px] leading-[22px]">{draft}</p>
      {opened ? (
        // Handed off: the card collapses to the message that went and one way back into the conversation.
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={copy.draftHandedOffLabel}
          onClick={open}
          className="mt-3 flex w-full items-center justify-center gap-2.5 whitespace-nowrap rounded-full bg-group px-[14px] py-[11px] text-[15px] font-semibold text-ink transition-colors hover:bg-bubble-muse"
        >
          {/* The WhatsApp glyph with Muse's check as a badge on its lower right, on a disc the color of the button so it reads. */}
          <span className="relative inline-grid shrink-0">
            <WhatsAppGlyph />
            <span className="absolute -bottom-[5px] -right-[6px] grid place-items-center rounded-full bg-group">
              <CheckMark className="size-3" />
            </span>
          </span>
          {copy.draftHandedOff}
        </a>
      ) : (
        <div className="mt-3 grid grid-cols-[auto_1fr] gap-2.5">
          <button
            type="button"
            onClick={handleCopy}
            className="whitespace-nowrap rounded-full bg-group px-5 py-2.5 text-[15px] font-semibold transition-colors hover:bg-bubble-muse"
          >
            <span aria-live="polite">{copied ? copy.draftCopied : copy.draftCopy}</span>
          </button>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={open}
            className="flex items-center justify-center gap-2 whitespace-nowrap rounded-full bg-accent px-3 py-2.5 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 active:brightness-90"
          >
            <WhatsAppGlyph />
            {copy.draftOpenWhatsApp}
          </a>
        </div>
      )}
    </section>
  );
}
