"use client";

import { Film, UserRound } from "lucide-react";
import { useState } from "react";
import { postSignal, postSimulatedFriend, type Result } from "@/lib/ui/actions";
import { copy } from "@/lib/ui/copy";

type Props = {
  variant: "send-reel" | "simulated-friend";
  friendName: string;
  onChanged: () => void;
  /** A recording is on screen: show the card, but starting a run would touch live state. */
  readOnly: boolean;
};

/**
 * What a judge taps to begin. Side b sends the shawarma reel to side a; a judge
 * alone on side a brings in the simulated friend, who then sends it.
 */
export function StartCard({ variant, friendName, onChanged, readOnly }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendsReel = variant === "send-reel";

  async function start() {
    if (readOnly) return;
    setPending(true);
    setError(null);
    const result: Result = await (sendsReel ? postSignal() : postSimulatedFriend());
    setPending(false);
    if (!result.ok) setError(result.message);
    onChanged();
  }

  return (
    <section className="max-w-[92%] animate-card-in rounded-card bg-surface p-5 shadow-float">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-tile bg-group">
          {sendsReel ? <Film className="size-5" strokeWidth={1.75} aria-hidden="true" /> : <UserRound className="size-5" strokeWidth={1.75} aria-hidden="true" />}
        </span>
        <div>
          <h3 className="text-[17px] font-semibold leading-[22px]">{sendsReel ? copy.sendReelTitle(friendName) : copy.simulatedTitle}</h3>
          <p className="mt-0.5 text-[13px] leading-[18px] text-muted">{sendsReel ? copy.sendReelDetail : copy.simulatedDetail}</p>
        </div>
      </div>
      <button
        type="button"
        disabled={pending || readOnly}
        onClick={start}
        className="mt-4 w-full rounded-full bg-accent px-4 py-2.5 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 active:brightness-90 disabled:opacity-50"
      >
        {sendsReel ? copy.sendReelAction(friendName) : copy.simulatedAction}
      </button>
      {error ? (
        <p role="alert" className="mt-3 text-[13px] leading-[18px] text-withheld">
          {error}
        </p>
      ) : null}
    </section>
  );
}
