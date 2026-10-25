"use client";

import { useEffect, useRef, useState } from "react";
import type { PhoneStatus } from "@/lib/ui/chat";

type Props = {
  name: string;
  /** An animated glyph and lowercase words: "talking to Mochi". Null when the Muse is idle. */
  status: PhoneStatus | null;
};

/** How long "sent" stays under the name before the pill goes back to the name alone. */
const DONE_VISIBLE_MS = 2000;
/** The old status fades out over this long before the new one rises in. */
const FADE_OUT_MS = 120;

const keyOf = (status: PhoneStatus | null) => (status ? `${status.glyph}:${status.text}` : null);

/**
 * The avatar's name pill. It grows a second line while the Muse is working on something: a 14px animated glyph from
 * public/status (an img, so each file's own styles and its reduced-motion still stay isolated) and the words. When
 * the status changes the old one fades out (120ms), the new one rises 4px into place (180ms) and the pill's width
 * follows (220ms); "sent" shows for two seconds and goes.
 */
export function StatusPill({ name, status }: Props) {
  const incomingKey = keyOf(status);
  const [shown, setShown] = useState<PhoneStatus | null>(status);
  const [seenKey, setSeenKey] = useState(incomingKey);
  const [leaving, setLeaving] = useState(false);
  const [clearedDone, setClearedDone] = useState<string | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const inner = useRef<HTMLDivElement>(null);

  // A new status: nothing on screen yet shows at once; otherwise the old one fades out first.
  if (incomingKey !== seenKey) {
    setSeenKey(incomingKey);
    if (shown === null) setShown(status);
    else setLeaving(true);
  }

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => {
      setShown(status);
      setLeaving(false);
    }, FADE_OUT_MS);
    return () => clearTimeout(timer);
  }, [leaving, status]);

  const shownKey = keyOf(shown);
  useEffect(() => {
    if (!shownKey || !shownKey.startsWith("done:")) return;
    const timer = setTimeout(() => setClearedDone(shownKey), DONE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [shownKey]);

  // The pill is as wide as its content, and moves between widths instead of jumping.
  useEffect(() => {
    const element = inner.current;
    if (!element) return;
    const frame = requestAnimationFrame(() => setWidth(element.offsetWidth));
    return () => cancelAnimationFrame(frame);
  }, [shownKey, name]);

  const visible = shown !== null && clearedDone !== shownKey;
  return (
    <div style={{ width: width ?? undefined }} className="relative z-10 -mt-1.5 overflow-hidden rounded-tile bg-surface text-center shadow-float transition-[width] duration-[220ms] ease-out">
      <div ref={inner} className="mx-auto w-max px-3 py-1">
        <p className="text-[15px] font-semibold leading-5">{name}</p>
        {visible ? (
          <p
            key={shownKey}
            className={`flex items-center justify-center gap-1.5 whitespace-nowrap text-[13px] leading-[18px] text-muted ${
              leaving ? "opacity-0 transition-opacity duration-[120ms]" : "animate-status-in"
            }`}
            aria-live="polite"
          >
            {/* A fixed, decorative glyph that animates on its own; next/image would not play it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/status/status-${shown.glyph}.svg`} alt="" width={14} height={14} className="size-3.5 shrink-0" />
            {shown.text}
          </p>
        ) : null}
      </div>
    </div>
  );
}
