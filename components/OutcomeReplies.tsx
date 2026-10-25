"use client";

import { useState } from "react";
import { postOutcome } from "@/lib/ui/actions";
import { copy } from "@/lib/ui/copy";
import type { Role } from "@/lib/ui/types";

type Props = {
  planId: string;
  role: Role;
  onChanged: () => void;
  /** A recording is on screen: show the replies, but answering would touch live state. */
  readOnly: boolean;
};

/** The two quick replies to "Did you two make it?". Only "We went!" counts toward Follow-through. */
export function OutcomeReplies({ planId, role, onChanged, readOnly }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(result: "went" | "didnt") {
    if (readOnly) return;
    setPending(true);
    setError(null);
    const response = await postOutcome(planId, role, result);
    setPending(false);
    if (!response.ok) setError(response.message);
    onChanged();
  }

  return (
    <div className="flex animate-fade-in flex-col items-end gap-2">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || readOnly}
          onClick={() => answer("didnt")}
          className="rounded-full bg-group px-4 py-2 text-[15px] font-semibold transition-colors hover:bg-bubble-muse disabled:opacity-50"
        >
          {copy.outcomeDidnt}
        </button>
        <button
          type="button"
          disabled={pending || readOnly}
          onClick={() => answer("went")}
          className="rounded-full bg-accent px-4 py-2 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 active:brightness-90 disabled:opacity-50"
        >
          {copy.outcomeWent}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-[13px] leading-[18px] text-withheld">
          {error}
        </p>
      ) : null}
    </div>
  );
}
