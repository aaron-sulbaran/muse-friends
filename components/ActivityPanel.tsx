"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copy } from "@/lib/ui/copy";
import { listOf, namesFor } from "@/lib/ui/format";
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
  /** Set when the panel is a sheet on a phone: no card chrome, a compact stepper, and a way to close it. */
  onClose?: () => void;
  /** Below the timeline: on a phone, the one control the presenter's keyboard would otherwise hold. */
  footer?: React.ReactNode;
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
  const { agent, agents } = snapshot.inFlight;
  const names = namesFor(snapshot);
  return (
    <li className="animate-row-in">
      <div className="flex items-center gap-3 rounded-group bg-group px-3 py-2.5">
        <MuseAvatar agent={agent} name={names.muse[agent]} size={36} />
        <span className="text-[15px] leading-5">{copy.thinking(listOf(agents.map((member) => names.muse[member])), agents.length)}</span>
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
        <MuseAvatar agent={agent} name={names.muse[agent]} size={36} />
        <span className="text-[15px] leading-5 text-withheld">{copy.modelErrorSecond(names.muse[agent])}</span>
      </div>
    </li>
  );
}

/** The one new surface: Muse's Activity view, extended from one agent to two. */
export function ActivityPanel({ snapshot, connected, onOpenMessage, onClose, footer }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const sheet = onClose !== undefined;
  const stuckToBottom = useRef(true);
  const messageCount = snapshot?.messages.length ?? 0;
  const thinking = Boolean(snapshot?.inFlight);

  useEffect(() => {
    const element = scroller.current;
    if (element && stuckToBottom.current) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [messageCount, thinking]);

  useEffect(() => {
    if (sheet) closeButton.current?.focus();
  }, [sheet]);

  function trackScroll() {
    const element = scroller.current;
    if (!element) return;
    stuckToBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
  }

  return (
    <section
      aria-label={copy.activityTitle}
      className={`flex h-full min-h-0 flex-col bg-surface ${sheet ? "px-4 pb-4 pt-5" : "rounded-card p-5 shadow-float"}`}
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-[22px] font-semibold leading-7">{copy.activityTitle}</h2>
        <div className="flex items-center gap-2">
          {snapshot ? <ReplayBadge mode={snapshot.mode} compact={sheet} /> : null}
          {sheet ? (
            <button
              ref={closeButton}
              type="button"
              onClick={onClose}
              aria-label={copy.activityClose}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-group transition-colors hover:bg-bubble-muse"
            >
              <X className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>
      {!connected ? <p className="mt-1 text-[13px] leading-[18px] text-muted">{copy.reconnecting}</p> : null}
      <div className="mt-4">
        <StateStepper plan={snapshot?.plan ?? null} compact={sheet} />
      </div>
      <div ref={scroller} onScroll={trackScroll} className="quiet-scroll -mx-2 mt-4 min-h-0 flex-1 overflow-y-auto px-2">
        {snapshot && snapshot.messages.length === 0 && snapshot.notes.length === 0 && !snapshot.inFlight ? (
          <p className="px-1 py-6 text-[15px] leading-5 text-muted">{copy.activityEmpty(snapshot.sides.aaron, snapshot.sides.lisa)}</p>
        ) : null}
        <ul aria-live="polite" className="flex flex-col gap-1">
          {snapshot
            ? timelineOf(snapshot).map((entry) =>
                entry.kind === "message" ? (
                  <ActivityRow key={`${entry.message.id}-${entry.message.at}`} message={entry.message} names={namesFor(snapshot)} onOpen={onOpenMessage} />
                ) : (
                  <ActivityNote key={entry.note.id} note={entry.note} />
                ),
              )
            : null}
          {snapshot ? <FailureRow snapshot={snapshot} /> : null}
          {snapshot?.inFlight ? <ThinkingRow key={`${snapshot.inFlight.agent}-${snapshot.messages.length}`} snapshot={snapshot} /> : null}
        </ul>
      </div>
      {footer ? <div className="mt-3 shrink-0">{footer}</div> : null}
    </section>
  );
}
