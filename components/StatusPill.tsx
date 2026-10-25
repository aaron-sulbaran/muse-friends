"use client";

import { useEffect, useState } from "react";
import type { PhoneStatus } from "@/lib/ui/chat";

type Props = {
  name: string;
  /** An animated glyph and lowercase words: "talking to Mochi". Null when the Muse is idle. */
  status: PhoneStatus | null;
};

/** How long "sent" stays under the name before the pill goes back to the name alone. */
const DONE_VISIBLE_MS = 2000;

/**
 * The avatar's name pill. It grows a second line while the Muse is working on something: a 14px animated glyph from
 * public/status (an img, so each file's own styles and its reduced-motion still stay isolated) and the words. A new
 * status rises 4px into place; "sent" shows for two seconds and goes.
 */
export function StatusPill({ name, status }: Props) {
  const key = status ? `${status.glyph}:${status.text}` : null;
  const [clearedDone, setClearedDone] = useState<string | null>(null);

  useEffect(() => {
    if (!key || !key.startsWith("done:")) return;
    const timer = setTimeout(() => setClearedDone(key), DONE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [key]);

  const visible = status !== null && clearedDone !== key;
  return (
    <div className="relative z-10 -mt-1.5 rounded-tile bg-surface px-3 py-1 text-center shadow-float transition-[padding] duration-200">
      <p className="text-[15px] font-semibold leading-5">{name}</p>
      {visible ? (
        <p key={key} className="flex animate-status-in items-center justify-center gap-1.5 text-[13px] leading-[18px] text-muted" aria-live="polite">
          {/* A fixed, decorative glyph that animates on its own; next/image would not play it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/status/status-${status.glyph}.svg`} alt="" width={14} height={14} className="size-3.5 shrink-0" />
          {status.text}
        </p>
      ) : null}
    </div>
  );
}
