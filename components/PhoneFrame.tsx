"use client";

import { useEffect, useRef, useState } from "react";
import { phone } from "@/lib/ui/tokens";

const outerWidth = phone.width + phone.bezel * 2;
const outerHeight = phone.height + phone.bezel * 2;

/** The Muse phone bezel: a white frame around a 390 by 844 screen. */
export function PhoneFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="relative rounded-phone bg-surface shadow-phone ring-1 ring-bezel-line"
      style={{ width: outerWidth, height: outerHeight, padding: phone.bezel }}
    >
      <div className="relative h-full w-full overflow-hidden rounded-[38px] bg-screen">{children}</div>
    </div>
  );
}

/** Scales a framed phone down to fit whatever space its parent gives it, never up. */
export function FitPhone({ label, children }: { label: string; children: React.ReactNode }) {
  const slot = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const element = slot.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width === 0 || height === 0) return;
      setScale(Math.min(1, width / outerWidth, height / outerHeight));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={slot} className="flex h-full w-full items-center justify-center">
      <div style={{ width: outerWidth * scale, height: outerHeight * scale }}>
        <div style={{ width: outerWidth, height: outerHeight, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <PhoneFrame label={label}>{children}</PhoneFrame>
        </div>
      </div>
    </div>
  );
}
