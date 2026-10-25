"use client";

import { X } from "lucide-react";
import qrcode from "qrcode-generator";
import { useEffect, useMemo, useRef, useState } from "react";
import { postSimulatedFriendSwitch } from "@/lib/ui/actions";
import { copy } from "@/lib/ui/copy";
import { friendLink, runInProgress } from "@/lib/ui/entry";
import { getRoom } from "@/lib/ui/room";
import type { UiPlan } from "@/lib/ui/types";

type Props = {
  plan: UiPlan | null;
  /** Michelle is playing the friend right now; bringing a real one in switches her off for the room. */
  simulatedFriend: boolean;
  /** Called after the room changes so the caller can refresh the snapshot at once. */
  onChanged: () => void;
  onClose: () => void;
};

/** A QR code as one path of dark modules, so it scales to any size and nothing here is injected as markup. */
function QrCode({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(text);
    code.make();
    const count = code.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (code.isDark(row, column)) d += `M${column} ${row}h1v1h-1z`;
      }
    }
    return { size: count, path: d };
  }, [text]);
  return (
    <svg viewBox={`-2 -2 ${size + 4} ${size + 4}`} shapeRendering="crispEdges" role="img" aria-label={copy.inviteQrLabel} className="size-48 rounded-group bg-white">
      <path d={path} fill="#000" />
    </svg>
  );
}

/**
 * Bring a friend in: their own Muse, in the same room, with Michelle stepping out. Michelle is a room-level switch and
 * turning her off clears the room, so before a plan starts this simply does it; once a plan has started it says so and
 * asks, and never resets silently.
 */
export function InviteSheet({ plan, simulatedFriend, onChanged, onClose }: Props) {
  const needsConfirm = runInProgress(plan);
  const [step, setStep] = useState<"confirm" | "switching" | "ready">(needsConfirm ? "confirm" : simulatedFriend ? "switching" : "ready");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const started = useRef(false);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  // The link is built in the browser, where the address is known.
  useEffect(() => {
    const timer = setTimeout(() => setLink(friendLink(window.location.origin, getRoom())), 0);
    return () => clearTimeout(timer);
  }, []);

  async function switchMichelleOff() {
    setStep("switching");
    setError(null);
    const result = await postSimulatedFriendSwitch(false);
    onChanged();
    if (result.ok) setStep("ready");
    else {
      setError(result.message);
      setStep(needsConfirm ? "confirm" : "ready");
    }
  }

  // Before a plan starts there is nothing to lose: step Michelle out as the sheet opens.
  useEffect(() => {
    if (started.current || needsConfirm || !simulatedFriend) return;
    started.current = true;
    void switchMichelleOff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-end bg-black/10"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={copy.inviteTitle}
        className="max-h-[88%] w-full animate-card-in overflow-y-auto rounded-t-card bg-surface px-5 pb-8 pt-5 shadow-float"
      >
        <header className="flex items-start justify-between gap-3">
          <h2 className="text-[17px] font-semibold leading-[22px]">{copy.inviteTitle}</h2>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label={copy.drawerClose}
            className="grid size-9 shrink-0 place-items-center rounded-full bg-group transition-colors hover:bg-bubble-muse"
          >
            <X className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </header>

        {step === "confirm" ? (
          <>
            <p className="mt-2 text-[15px] leading-5 text-muted">{copy.inviteRestartLine}</p>
            <div className="mt-5 grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="rounded-full bg-group px-3 py-2.5 text-[15px] font-semibold transition-colors hover:bg-bubble-muse"
              >
                {copy.inviteNotNow}
              </button>
              <button
                type="button"
                onClick={() => void switchMichelleOff()}
                className="rounded-full bg-accent px-3 py-2.5 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 active:brightness-90"
              >
                {copy.inviteStartOver}
              </button>
            </div>
          </>
        ) : step === "switching" ? (
          <p className="mt-2 text-[15px] leading-5 text-muted">{copy.inviteSwitching}</p>
        ) : (
          <>
            <p className="mt-2 text-[15px] leading-5 text-muted">{copy.inviteLine}</p>
            {link ? (
              <div className="mt-5 flex flex-col items-center gap-4">
                <QrCode text={link} />
                <button
                  type="button"
                  onClick={copyLink}
                  className="rounded-full bg-group px-5 py-2.5 text-[15px] font-semibold transition-colors hover:bg-bubble-muse"
                >
                  {copied ? copy.inviteCopied : copy.inviteCopy}
                </button>
              </div>
            ) : null}
          </>
        )}
        {error ? (
          <p role="alert" className="mt-3 text-[13px] leading-[18px] text-withheld">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
