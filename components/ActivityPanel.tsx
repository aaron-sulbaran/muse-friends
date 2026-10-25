"use client";

import { useEffect, useRef, useState } from "react";
import { copy } from "@/lib/ui/copy";
import { discInitials, namesFor } from "@/lib/ui/format";
import { timelineOf } from "@/lib/ui/timeline";
import type { UiMessage, UiSnapshot } from "@/lib/ui/types";
import { ActivityNote } from "./ActivityNote";
import { ActivityRow } from "./ActivityRow";
import { MuseAvatar } from "./MuseAvatar";
import { ReplayBadge } from "./ReplayBadge";
import { StateStepper } from "./StateStepper";

type Props = {
  snapshot: UiSnapshot | null;
  connected: boolean;
  onOpenMessage: (message: UiMessage) => void;
};

/** Counts seconds from when this row first appeared; the parent re-keys it per turn so each model call starts at 0. */
function ThinkingRow({ snapshot }: { snapshot: UiSnapshot }) {
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500);
    return () => clearInterval(timer);
  }, [startedAt]);

  if (!snapshot.inFlight) return null;
  const agent = snapshot.inFlight.agent;
  const names = namesFor(snapshot);
  const initial = discInitials(snapshot)[agent];
  return (
    <li className="animate-row-in">
      <div className="flex items-center gap-3 rounded-group bg-group px-3 py-2.5">
        <MuseAvatar agent={agent} initial={initial} name={names.muse[agent]} size={36} />
        <span className="text-[15px] leading-5">{names.muse[agent]} is thinking</span>
        <span className="flex gap-1" aria-hidden="true">
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="size-1.5 animate-typing rounded-full bg-muted" style={{ animationDelay: `${dot * 150}ms` }} />
          ))}
        </span>
        <span className="ml-auto text-[12px] tabular-nums text-muted">{elapsed}s</span>
      </div>
    </li>
  );
}

function FailureRow({ snapshot }: { snapshot: UiSnapshot }) {
  if (!snapshot.failure) return null;
  const names = namesFor(snapshot);
  const agent = snapshot.failure.agent;
  return (
    <li className="animate-row-in">
      <div className="flex items-center gap-3 rounded-group px-3 py-2.5">
        <MuseAvatar agent={agent} initial={discInitials(snapshot)[agent]} name={names.muse[agent]} size={36} />
        <span className="text-[15px] leading-5 text-withheld">{copy.modelErrorSecond(names.muse[agent])}</span>
      </div>
    </li>
  );
}

/** The one new surface: Muse's Activity view, extended from one agent to two. */
export function ActivityPanel({ snapshot, connected, onOpenMessage }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const stuckToBottom = useRef(true);
  const messageCount = snapshot?.messages.length ?? 0;
  const thinking = Boolean(snapshot?.inFlight);

  useEffect(() => {
    const element = scroller.current;
    if (element && stuckToBottom.current) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [messageCount, thinking]);

  function trackScroll() {
    const element = scroller.current;
    if (!element) return;
    stuckToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
  }

  return (
    <section aria-label={copy.activityTitle} className="flex h-full min-h-0 flex-col rounded-card bg-surface p-5 shadow-float">
      <header className="flex items-center justify-between">
        <h2 className="text-[22px] font-semibold leading-7">{copy.activityTitle}</h2>
        {snapshot ? <ReplayBadge mode={snapshot.mode} /> : null}
      </header>
      {!connected ? <p className="mt-1 text-[13px] leading-[18px] text-muted">{copy.reconnecting}</p> : null}
      <div className="mt-4">
        <StateStepper plan={snapshot?.plan ?? null} />
      </div>
      <div ref={scroller} onScroll={trackScroll} className="quiet-scroll -mx-2 mt-4 min-h-0 flex-1 overflow-y-auto px-2">
        {snapshot && snapshot.messages.length === 0 && snapshot.notes.length === 0 && !snapshot.inFlight ? (
          <p className="px-1 py-6 text-[15px] leading-5 text-muted">{copy.activityEmpty(snapshot.sides.aaron, snapshot.sides.lisa)}</p>
        ) : null}
        <ul aria-live="polite" className="flex flex-col gap-1">
          {snapshot
            ? timelineOf(snapshot).map((entry) =>
                entry.kind === "message" ? (
                  <ActivityRow key={`${entry.message.id}-${entry.message.at}`} message={entry.message} initials={discInitials(snapshot)} names={namesFor(snapshot)} onOpen={onOpenMessage} />
                ) : (
                  <ActivityNote key={entry.note.id} note={entry.note} />
                ),
              )
            : null}
          {snapshot ? <FailureRow snapshot={snapshot} /> : null}
          {snapshot?.inFlight ? <ThinkingRow key={`${snapshot.inFlight.agent}-${snapshot.messages.length}`} snapshot={snapshot} /> : null}
        </ul>
      </div>
    </section>
  );
}
