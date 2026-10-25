"use client";

import { useEffect, useRef, useState } from "react";
import { postClockAdvance, postGroupSignal, postLeakAttempt, postReset, postSignal, postTripSignal, type LeakAttempt, type Result } from "@/lib/ui/actions";
import { copy } from "@/lib/ui/copy";
import type { UiSnapshot } from "@/lib/ui/types";

type Props = {
  snapshot: UiSnapshot | null;
  onChanged: () => void;
  replay: { active: boolean; start: () => Promise<void>; stop: () => void; error: string | null };
  /** A run could not start because the live-run caps are reached; the stage falls back to a recording. */
  onPaused: (text: string) => void;
};

/**
 * Presenter-only controls: start the run, move the clock, reset the room. Each
 * posts to the real route and the timeline fills from the store as the agents work.
 */
export function DemoControls({ snapshot, onChanged, replay, onPaused }: Props) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [leak, setLeak] = useState<{ attempts: LeakAttempt[] } | { running: true } | { failed: string } | null>(null);

  const plan = snapshot?.plan ?? null;
  const planIsAlive = plan !== null && plan.state !== "dropped";
  const canJump = plan !== null && (plan.state === "confirmed" || plan.state === "scheduled" || plan.state === "reminded");
  const jumpLabel = plan?.state === "reminded" ? "Jump to next day" : "Jump to reminder";

  async function run(action: () => Promise<Result>) {
    const result = await action();
    if (!result.ok && result.paused) onPaused(result.message);
    setMessage(result.ok || result.paused ? null : result.message);
    onChanged();
  }

  const toggleReplay = async () => {
    if (replay.active) replay.stop();
    else await replay.start();
  };
  const loadReel = () => run(postSignal);
  const planForThree = () => run(postGroupSignal);
  const planTrip = () => run(postTripSignal);
  const tryToLeak = async () => {
    setLeak({ running: true });
    const result = await postLeakAttempt();
    setLeak(result.ok ? { attempts: result.attempts } : { failed: result.message });
    onChanged();
  };
  const jump = () => run(postClockAdvance);
  const reset = () => run(postReset);

  const actions = useRef({ loadReel, planForThree, planTrip, tryToLeak, jump, reset, toggleReplay });
  useEffect(() => {
    actions.current = { loadReel, planForThree, planTrip, tryToLeak, jump, reset, toggleReplay };
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector("dialog[open]")) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (key === "s") void actions.current.loadReel();
      else if (key === "g") void actions.current.planForThree();
      else if (key === "t") void actions.current.planTrip();
      else if (key === "l") void actions.current.tryToLeak();
      else if (key === "f") void actions.current.jump();
      else if (key === "0") void actions.current.reset();
      else if (key === "r") void actions.current.toggleReplay();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const replaying = replay.active;
  const items: ReadonlyArray<{ label: string; key: string; run: () => void; disabled?: boolean }> = [
    { label: "Load the shawarma reel", key: "S", run: loadReel, disabled: planIsAlive || replaying },
    { label: copy.planForThree, key: "G", run: planForThree, disabled: planIsAlive || replaying },
    { label: copy.planATrip, key: "T", run: planTrip, disabled: planIsAlive || replaying },
    { label: jumpLabel, key: "F", run: jump, disabled: !canJump || replaying },
    { label: replaying ? "Stop the replay" : "Replay a recorded run", key: "R", run: toggleReplay },
    { label: "Try to leak", key: "L", run: tryToLeak, disabled: replaying || (leak !== null && "running" in leak) },
    { label: "Reset", key: "0", run: reset, disabled: replaying },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="rounded-full bg-surface px-4 py-2 text-[13px] font-semibold shadow-float transition-colors hover:bg-group"
      >
        Demo controls
      </button>
      {open ? (
        <div role="menu" className={`absolute bottom-full left-0 mb-2 ${leak ? "w-80" : "w-64"} animate-pop-in rounded-card bg-surface p-2 shadow-float`}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={item.run}
              className="flex w-full items-center justify-between rounded-group px-3 py-2 text-left text-[15px] transition-colors hover:bg-group disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {item.label}
              <kbd className="rounded-tile bg-group px-1.5 py-0.5 font-sans text-[12px] text-muted">{item.key}</kbd>
            </button>
          ))}
          {leak ? <LeakResult leak={leak} /> : null}
          {message ?? replay.error ? (
            <p role="alert" className="px-3 pb-2 pt-1 text-[13px] leading-[18px] text-withheld">
              {message ?? replay.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** What the inbox answered to each forged message, in its own words: a refusal is the point, so it is shown, not hidden. */
function LeakResult({ leak }: { leak: { attempts: LeakAttempt[] } | { running: true } | { failed: string } }) {
  if ("running" in leak) return <p className="px-3 py-2 text-[13px] leading-[18px] text-muted">Sending two forged messages to Mochi&apos;s inbox...</p>;
  if ("failed" in leak) {
    return (
      <p role="alert" className="px-3 py-2 text-[13px] leading-[18px] text-withheld">
        {leak.failed}
      </p>
    );
  }
  const delivered = leak.attempts.some((attempt) => !attempt.rejected);
  return (
    <div className="mt-1 border-t border-bezel-line px-3 pb-2 pt-2" aria-live="polite">
      <ul className="flex flex-col gap-2.5">
        {leak.attempts.map((attempt) => (
          <li key={attempt.id}>
            <p className="text-[13px] leading-[18px]">
              <span className={`font-semibold ${attempt.rejected ? "text-tracking" : "text-withheld"}`}>
                {attempt.status || "No answer"} {attempt.rejected ? "Refused" : "Accepted"}
              </span>
              <span className="text-muted">: {attempt.label}</span>
            </p>
            <p className="mt-0.5 break-words font-mono text-[12px] leading-[17px]">{attempt.error}</p>
          </li>
        ))}
      </ul>
      <p className={`mt-2 text-[13px] font-semibold leading-[18px] ${delivered ? "text-withheld" : ""}`}>
        {delivered ? "A forged message got through." : "Nothing was delivered. The checks are code, not a prompt."}
      </p>
    </div>
  );
}
