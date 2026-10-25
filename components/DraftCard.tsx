"use client";

import { useEffect, useState } from "react";
import { copy } from "@/lib/ui/copy";
import { whatsAppUrl } from "@/lib/ui/handoff";

type Props = {
  draft: string;
  /** Called when the person takes the draft away, by either route. */
  onHandoff: (via: "whatsapp" | "copy") => void;
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
 * link does not open.
 */
export function DraftCard({ draft, onHandoff }: Props) {
  const [copied, setCopied] = useState(false);

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

  return (
    <section aria-label="Draft message" className="max-w-[92%] animate-card-in rounded-card bg-surface p-4 shadow-float">
      <p className="rounded-group bg-group px-3.5 py-3 text-[16px] leading-[22px]">{draft}</p>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={handleCopy}
          className="whitespace-nowrap rounded-full bg-group px-3 py-2.5 text-[15px] font-semibold transition-colors hover:bg-bubble-muse"
        >
          <span aria-live="polite">{copied ? copy.draftCopied : copy.draftCopy}</span>
        </button>
        <a
          href={whatsAppUrl(draft)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onHandoff("whatsapp")}
          className="whitespace-nowrap rounded-full bg-accent px-3 py-2.5 text-center text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 active:brightness-90"
        >
          {copy.draftOpenWhatsApp}
        </a>
      </div>
    </section>
  );
}
