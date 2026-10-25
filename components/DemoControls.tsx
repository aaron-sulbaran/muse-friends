"use client";

import { useEffect, useRef, useState } from "react";
import { postStep } from "@/lib/ui/actions";
import type { UiSnapshot } from "@/lib/ui/types";

type Props = {
  snapshot: UiSnapshot | null;
  onChanged: () => void;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Bumped by every load and reset so an older playback stops itself. One controls panel exists at a time. */
let activeRun = 0;

/** Gaps between the four recorded messages when the reel is loaded; roughly what live model calls take. */
const messageGapsMs = [2200, 2600, 2400, 2200];

/**
 * Presenter-only controls. While the recorded run stands in for the live
 * agents, "Load Lisa's reel" plays the thread from the browser; once the real
 * signal route exists it only posts the signal.
 */
export function DemoControls({ snapshot, onChanged }: Props) {
  const [open, setOpen] = useState(false);

  const plan = snapshot?.plan ?? null;
  const canJump = plan !== null && (plan.state === "scheduled" || plan.state === "confirmed" || plan.state === "reminded");
  const jumpLabel = plan?.state === "reminded" ? "Jump to next day" : "Jump to reminder";

  async function loadReel() {
    const myRun = ++activeRun;
    await postStep({ type: "load_reel" });
    onChanged();
    for (const gap of messageGapsMs) {
      await wait(gap);
      if (activeRun !== myRun) return;
      await postStep({ type: "next_message" });
      onChanged();
    }
  }

  async function nextMessage() {
    await postStep({ type: "next_message" });
    onChanged();
  }

  async function jump() {
    await postStep({ type: "clock_next" });
    onChanged();
  }

  async function reset() {
    activeRun++;
    await postStep({ type: "reset" });
    onChanged();
  }

  const actions = useRef({ loadReel, nextMessage, jump, reset });
  useEffect(() => {
    actions.current = { loadReel, nextMessage, jump, reset };
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector("dialog[open]")) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))) return;
      const key = event.key.toLowerCase();
      if (key === "s") void actions.current.loadReel();
      else if (key === "n") void actions.current.nextMessage();
      else if (key === "f") void actions.current.jump();
      else if (key === "0") void actions.current.reset();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const items: ReadonlyArray<{ label: string; key: string; run: () => void; disabled?: boolean }> = [
    { label: "Load Lisa's reel", key: "S", run: loadReel, disabled: plan !== null },
    { label: "Next message", key: "N", run: nextMessage, disabled: plan === null || plan.state !== "negotiating" && plan.state !== "detected" },
    { label: jumpLabel, key: "F", run: jump, disabled: !canJump || plan?.state === "followed_up" },
    { label: "Reset", key: "0", run: reset },
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
        <div role="menu" className="absolute bottom-full left-0 mb-2 w-60 animate-pop-in rounded-card bg-surface p-2 shadow-float">
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
        </div>
      ) : null}
    </div>
  );
}
