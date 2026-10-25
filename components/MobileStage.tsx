"use client";

import { useRef, useState } from "react";
import { namesFor } from "@/lib/ui/format";
import type { UiMessage, UiSnapshot } from "@/lib/ui/types";
import { ActivityPanel } from "./ActivityPanel";
import { MuseScreen } from "./MuseScreen";

type Props = {
  snapshot: UiSnapshot | null;
  connected: boolean;
  readOnly: boolean;
  onChanged: () => void;
  onOpenMessage: (message: UiMessage) => void;
  /** Past the live-run caps: the stage plays a recording and says why. */
  onPaused?: (text: string) => void;
};

/** Narrow-screen stage: Muse A, Activity, Muse B as swipeable panes, so it reads like the desktop order. */
export function MobileStage({ snapshot, connected, readOnly, onChanged, onOpenMessage, onPaused }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [seen, setSeen] = useState<number | null>(null);
  const names = snapshot ? namesFor(snapshot) : null;
  const count = snapshot ? snapshot.messages.length + snapshot.notes.length : 0;

  // Adjusting state during render: the first snapshot and a visit to Activity both count as "seen".
  if (snapshot && (seen === null || (index === 1 && seen !== count))) setSeen(count);
  const unread = index !== 1 && seen !== null && count > seen;

  const labels = [names?.muse.aaron ?? "Sprout", "Activity", names?.muse.lisa ?? "Mochi"];

  function goTo(next: number) {
    const element = scroller.current;
    element?.scrollTo({ left: next * element.clientWidth, behavior: "smooth" });
  }

  return (
    <div className="flex h-[calc(100dvh-104px)] min-h-0 flex-col">
      <div role="tablist" aria-label="Stage" className="mx-4 mb-2 flex shrink-0 gap-1 rounded-full bg-group p-1">
        {labels.map((label, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={index === i}
            onClick={() => goTo(i)}
            className={`flex min-w-0 flex-auto items-center justify-center gap-1.5 rounded-full px-2.5 py-1.5 text-[13px] font-semibold transition-colors ${
              index === i ? "bg-surface text-ink shadow-float" : "text-muted"
            }`}
          >
            <span className="truncate">{label}</span>
            {i === 1 && unread ? (
              <span aria-label="New activity" className="size-2 shrink-0 animate-pulse rounded-full bg-accent-dot" />
            ) : null}
          </button>
        ))}
      </div>
      <div
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <section aria-label={labels[0]} className="h-full w-full shrink-0 snap-center overflow-hidden px-4 pb-2">
          {snapshot ? (
            <div className="relative h-full overflow-hidden rounded-card bg-screen shadow-float">
              <MuseScreen snapshot={snapshot} role="a" framed={false} onChanged={onChanged} readOnly={readOnly} onPaused={onPaused} />
            </div>
          ) : null}
        </section>
        <section aria-label={labels[1]} className="h-full w-full shrink-0 snap-center overflow-hidden px-4 pb-2">
          <ActivityPanel snapshot={snapshot} connected={connected} onOpenMessage={onOpenMessage} />
        </section>
        <section aria-label={labels[2]} className="h-full w-full shrink-0 snap-center overflow-hidden px-4 pb-2">
          {snapshot ? (
            <div className="relative h-full overflow-hidden rounded-card bg-screen shadow-float">
              <MuseScreen snapshot={snapshot} role="b" framed={false} onChanged={onChanged} readOnly={readOnly} onPaused={onPaused} />
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
