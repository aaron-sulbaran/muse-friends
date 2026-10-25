"use client";

import { UserRound } from "lucide-react";
import { useState } from "react";
import { postMemberDecision } from "@/lib/ui/actions";
import { copy } from "@/lib/ui/copy";
import type { MemberId } from "@/lib/ui/types";

type Props = {
  planId: string;
  member: MemberId;
  name: string;
  /** A model plays this person (one judge plays alone): the card says so, and the buttons stay as the way to answer for them. */
  simulated: boolean;
  /** A recording is on screen: show the card, but answering would touch live state. */
  readOnly: boolean;
  onChanged: () => void;
};

/**
 * A friend in a plan for three who has no phone (Kai, Pebble's person) still has to say yes, so the coordinator's phone
 * carries their card. With a real second phone the coordinator answers for them; when one judge plays alone a model
 * answers, and the card says so. Said plainly either way: Kai is fictional and this is not their own device.
 */
export function MemberCard({ planId, member, name, simulated, readOnly, onChanged }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(choice: "accept" | "decline") {
    if (readOnly) return;
    setPending(true);
    setError(null);
    const result = await postMemberDecision(planId, member, choice);
    setPending(false);
    if (!result.ok) setError(result.message);
    onChanged();
  }

  return (
    <section className="max-w-[92%] animate-card-in rounded-card bg-surface p-5 shadow-float">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-tile bg-group">
          <UserRound className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-[17px] font-semibold leading-[22px]">{simulated ? copy.memberDeciding(name) : copy.memberCardTitle(name)}</h3>
          <p className="mt-0.5 text-[13px] leading-[18px] text-muted">{simulated ? copy.memberPlayedByModel(name) : copy.memberCardDetail(name)}</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          disabled={pending || readOnly}
          onClick={() => decide("decline")}
          className="rounded-full bg-group px-3 py-2.5 text-[15px] font-semibold transition-colors hover:bg-bubble-muse active:bg-bubble-muse disabled:opacity-50"
        >
          {copy.memberDecline(name)}
        </button>
        <button
          type="button"
          disabled={pending || readOnly}
          onClick={() => decide("accept")}
          className="rounded-full bg-accent px-3 py-2.5 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 active:brightness-90 disabled:opacity-50"
        >
          {copy.memberAccept(name)}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-[13px] leading-[18px] text-withheld">
          {error}
        </p>
      ) : null}
    </section>
  );
}
