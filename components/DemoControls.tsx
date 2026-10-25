"use client";

import { Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { postClockAdvance, postGroupSignal, postLeakAttempt, postReset, postSignal, postTripSignal, type LeakAttempt, type Result } from "@/lib/ui/actions";
import { controlInfo, jumpLabel as jumpLabelFor, loadReelLabel, SCENARIO_LOCKED_NOTE, scenarios, type ControlKey } from "@/lib/ui/controls";
import { friendLink } from "@/lib/ui/entry";
import { getRoom } from "@/lib/ui/room";
import type { ReplayScenario } from "@/lib/ui/use-replay";
import type { UiSnapshot } from "@/lib/ui/types";

type Props = {
  snapshot: UiSnapshot | null;
  onChanged: () => void;
  replay: { active: boolean; start: (scenario?: ReplayScenario) => Promise<void>; stop: () => void; error: string | null };
  /** A run could not start because the live-run caps are reached; the stage falls back to a recording. */
  onPaused: (text: string) => void;
  /** Opens the panel on first render, for a panel drawn after the fact. */
  initiallyOpen?: boolean;
};

/**
 * Presenter-only controls: start the run, move the clock, reset the room. Each
 * posts to the real route and the timeline fills from the store as the agents work.
 * Each says in one sentence what it does: on hover on a laptop, behind an "i" on a phone.
 */
export function DemoControls({ snapshot, onChanged, replay, onPaused, initiallyOpen = false }: Props) {
  const [open, setOpen] = useState(initiallyOpen);
  const [infoOpen, setInfoOpen] = useState<ControlKey | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [leak, setLeak] = useState<{ attempts: LeakAttempt[] } | { running: true } | { failed: string } | null>(null);

  const plan = snapshot?.plan ?? null;
  const planIsAlive = plan !== null && plan.state !== "dropped";
  const canJump = plan !== null && (plan.state === "confirmed" || plan.state === "scheduled" || plan.state === "reminded");
  const jumpLabel = jumpLabelFor(plan?.state);

  // The friend's link is built in the browser, where the address is known, the same way the Invite sheet builds it.
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => setLink(friendLink(window.location.origin, getRoom())), 0);
    return () => clearTimeout(timer);
  }, [open]);

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      setLinkCopied(false);
    }
  }

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
  const toggleTripReplay = async () => {
    if (replay.active) replay.stop();
    else await replay.start("trip");
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

  const actions = useRef({ loadReel, planForThree, planTrip, tryToLeak, jump, reset, toggleReplay, toggleTripReplay });
  useEffect(() => {
    actions.current = { loadReel, planForThree, planTrip, tryToLeak, jump, reset, toggleReplay, toggleTripReplay };
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
      else if (key === "y") void actions.current.toggleTripReplay();
      else if (key === "l") void actions.current.tryToLeak();
      else if (key === "f") void actions.current.jump();
      else if (key === "0") void actions.current.reset();
      else if (key === "r") void actions.current.toggleReplay();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const replaying = replay.active;
  const items: ReadonlyArray<{ info: ControlKey; label: string; key: string; run: () => void; disabled?: boolean }> = [
    { info: "loadReel", label: loadReelLabel(snapshot?.reel ?? null), key: "S", run: loadReel, disabled: planIsAlive || replaying },
    { info: "jump", label: jumpLabel, key: "F", run: jump, disabled: !canJump || replaying },
    { info: "replay", label: replaying ? "Stop the replay" : "Replay a recorded run", key: "R", run: toggleReplay },
    { info: "replayTrip", label: replaying ? "Stop the replay" : "Replay the recorded trip", key: "Y", run: toggleTripReplay },
    { info: "leak", label: "Try to leak", key: "L", run: tryToLeak, disabled: replaying || (leak !== null && "running" in leak) },
    { info: "reset", label: "Reset", key: "0", run: reset, disabled: replaying },
  ];
  const toggleInfo = (key: ControlKey) => setInfoOpen((current) => (current === key ? null : key));

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
        <div role="group" aria-label="Demo controls" className={`absolute bottom-full left-0 mb-2 ${leak ? "w-80" : "w-72"} animate-pop-in rounded-card bg-surface p-2 shadow-float`}>
          {items.map((item) => (
            <ControlRow key={item.label} info={item.info} infoOpen={infoOpen === item.info} onToggleInfo={() => toggleInfo(item.info)}>
              <button
                type="button"
                disabled={item.disabled}
                onClick={item.run}
                className="flex min-w-0 flex-1 items-center justify-between rounded-group px-3 py-2 text-left text-[15px] transition-colors hover:bg-group disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {item.label}
                <kbd className="rounded-tile bg-group px-1.5 py-0.5 font-sans text-[12px] text-muted">{item.key}</kbd>
              </button>
            </ControlRow>
          ))}
          {leak ? <LeakResult leak={leak} /> : null}
          <div className="mt-1 border-t border-bezel-line pt-1">
            <ControlRow info="scenario" infoOpen={infoOpen === "scenario"} onToggleInfo={() => toggleInfo("scenario")}>
              <p className="flex-1 px-3 py-2 text-[15px]">Scenario</p>
            </ControlRow>
            <div role="radiogroup" aria-label="Scenario" className="px-1 pb-1">
              {scenarios.map((scenario) => (
                <button
                  key={scenario.id}
                  type="button"
                  role="radio"
                  aria-checked={scenario.available}
                  disabled={!scenario.available || (scenario.id !== "one-to-one" && (planIsAlive || replaying))}
                  onClick={scenario.id === "group" ? planForThree : scenario.id === "trip" ? planTrip : undefined}
                  className="flex w-full items-center justify-between rounded-group px-3 py-1.5 text-left text-[15px] disabled:opacity-40"
                >
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className={`size-2 rounded-full ${scenario.available ? "bg-accent" : "bg-faint"}`} />
                    {scenario.label}
                  </span>
                  {scenario.available ? null : <span className="text-[12px] text-muted">{SCENARIO_LOCKED_NOTE}</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-1 border-t border-bezel-line pt-1">
            <ControlRow info="invite" infoOpen={infoOpen === "invite"} onToggleInfo={() => toggleInfo("invite")}>
              <p className="flex-1 px-3 py-2 text-[15px]">Invite a friend</p>
            </ControlRow>
            <div className="flex items-center gap-2 px-3 pb-2">
              <p className="min-w-0 flex-1 truncate rounded-tile bg-group px-2 py-1 font-mono text-[12px] leading-[18px]" title={link ?? undefined}>
                {link ?? "..."}
              </p>
              <button
                type="button"
                disabled={!link}
                onClick={copyLink}
                className="shrink-0 rounded-full bg-group px-3 py-1 text-[13px] font-semibold transition-colors hover:bg-bubble-muse disabled:opacity-50"
              >
                {linkCopied ? "Copied" : "Copy link"}
              </button>
            </div>
          </div>
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

/**
 * One control's row: the control itself, and its one-sentence card. On a laptop the card floats beside the panel
 * while the row is hovered or focused; on a phone, where there is no hover, an "i" opens it under the row.
 */
function ControlRow({ info, infoOpen, onToggleInfo, children }: { info: ControlKey; infoOpen: boolean; onToggleInfo: () => void; children: React.ReactNode }) {
  const id = `control-info-${info}`;
  return (
    <div className="group relative">
      <div className="flex items-center">
        {children}
        <button
          type="button"
          onClick={onToggleInfo}
          aria-expanded={infoOpen}
          aria-controls={id}
          aria-label={`What this does: ${controlInfo[info]}`}
          className="grid size-9 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-group [@media(hover:hover)]:hidden"
        >
          <Info className="size-4" strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <p
        id={id}
        className={`${infoOpen ? "block" : "hidden"} mx-3 mb-2 text-[13px] leading-[18px] text-muted [@media(hover:hover)]:absolute [@media(hover:hover)]:left-full [@media(hover:hover)]:top-0 [@media(hover:hover)]:z-10 [@media(hover:hover)]:m-0 [@media(hover:hover)]:ml-3 [@media(hover:hover)]:w-60 [@media(hover:hover)]:rounded-group [@media(hover:hover)]:bg-surface [@media(hover:hover)]:p-3 [@media(hover:hover)]:text-ink [@media(hover:hover)]:shadow-float [@media(hover:hover)]:group-hover:block [@media(hover:hover)]:group-focus-within:block`}
      >
        {controlInfo[info]}
      </p>
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
