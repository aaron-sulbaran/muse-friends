"use client";

import { useEffect, useRef, useState } from "react";
import { copy } from "@/lib/ui/copy";
import { formatTime } from "@/lib/ui/format";
import type { UiSnapshot } from "@/lib/ui/types";

/**
 * The metric: human events only. Agent messages are listed below a hairline and
 * never counted, so the number can only move when a person does something.
 */
export function FollowThroughCounter({ followThrough }: { followThrough: UiSnapshot["followThrough"] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const count = followThrough.events.length;

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
        return;
      }
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`${copy.followThrough}: ${count}`}
        className="rounded-tile px-3 py-1 text-right transition-colors hover:bg-surface/70"
      >
        <span key={count} className={`block text-[22px] font-bold leading-7 tabular-nums ${count > 0 ? "animate-pop" : ""}`}>
          {count}
        </span>
        <span className="block text-[13px] leading-[18px] text-muted">{copy.followThrough}</span>
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-20 mt-2 w-72 animate-pop-in rounded-card bg-surface p-4 shadow-float">
          {count === 0 ? (
            <p className="text-[13px] leading-[18px] text-muted">{copy.followThroughEmpty}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {followThrough.events.map((event) => (
                <li key={event.id} className="flex items-baseline justify-between gap-3 text-[13px] leading-[18px]">
                  <span>{event.label}</span>
                  <span className="shrink-0 text-muted">{formatTime(event.at)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 border-t border-bezel-line pt-3 text-[12px] leading-4 text-faint">
            <p>{copy.humanTapsNotCounted(followThrough.humanTapCount)}</p>
            <p className="mt-1">{copy.agentMessagesNotCounted(followThrough.agentMessageCount)}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
