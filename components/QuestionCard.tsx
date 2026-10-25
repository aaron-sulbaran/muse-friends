"use client";

import { useState } from "react";
import { postTripAnswer } from "@/lib/ui/actions";
import { money } from "@/lib/ui/group";
import type { MemberId } from "@/lib/ui/types";
import { MuseAvatar } from "./MuseAvatar";

type Props = {
  planId: string;
  member: MemberId;
  /** Set when the card is for someone else (Kai, whose Muse asks the coordinator's phone); null when it is for you. */
  forName: string | null;
  range: { low: number; high: number };
  route: string;
  /** A recording is on screen: show the card, but answering would touch live state. */
  readOnly: boolean;
  onChanged: () => void;
};

/**
 * The bounded question (D30): a decision with fixed answers. Yes means the top of the range, No the bottom, or the person
 * gives their own limit in whole dollars; never free text, and what the group sees is only that answer. A person's reason
 * stays with their own Muse.
 */
export function QuestionCard({ planId, member, forName, range, route, readOnly, onChanged }: Props) {
  const [pending, setPending] = useState(false);
  const [limit, setLimit] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function answer(choice: "yes" | "no" | "limit", dollars?: number) {
    if (readOnly) return;
    setPending(true);
    setError(null);
    const result = await postTripAnswer(planId, member, choice, dollars);
    setPending(false);
    if (!result.ok) setError(result.message);
    onChanged();
  }

  const parsed = Number(limit.replace(/[^0-9]/g, ""));
  const limitOk = limit.trim() !== "" && Number.isInteger(parsed) && parsed >= 300 && parsed <= 20000;

  return (
    <section className="ml-8 max-w-[92%] animate-card-in rounded-card bg-surface p-5 shadow-float">
      <div className="flex items-center gap-2 text-[13px] font-semibold leading-[18px] text-muted">
        <MuseAvatar agent="aaron" name="Sprout" size={20} />
        {forName ? `Sprout asks for ${forName}` : "Sprout asks everyone"}
      </div>
      <h3 className="mt-2 text-[21px] font-bold leading-[26px]">
        Is {money(range.low)} to {money(range.high)} for flights okay{forName ? ` for ${forName}` : ""}?
      </h3>
      <p className="mt-1 text-[13px] leading-[18px] text-muted">{route}. The group sees only yes, no, or your number.</p>
      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <button
          type="button"
          disabled={pending || readOnly}
          onClick={() => answer("no")}
          className="rounded-full bg-group px-3 py-2.5 text-[15px] font-semibold transition-colors hover:bg-bubble-muse active:bg-bubble-muse disabled:opacity-50"
        >
          No
        </button>
        <button
          type="button"
          disabled={pending || readOnly}
          onClick={() => answer("yes")}
          className="rounded-full bg-accent px-3 py-2.5 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 active:brightness-90 disabled:opacity-50"
        >
          Yes
        </button>
      </div>
      <form
        className="mt-2.5 flex items-center gap-2 rounded-full bg-group py-1 pl-4 pr-1"
        onSubmit={(event) => {
          event.preventDefault();
          if (limitOk) void answer("limit", parsed);
        }}
      >
        <label htmlFor={`limit-${member}`} className="shrink-0 text-[15px] font-semibold">
          My limit is
        </label>
        <span className="text-[15px] text-muted">$</span>
        <input
          id={`limit-${member}`}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          placeholder="amount"
          value={limit}
          disabled={pending || readOnly}
          onChange={(event) => setLimit(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
        />
        <button
          type="submit"
          disabled={pending || readOnly || !limitOk}
          className="shrink-0 rounded-full bg-surface px-3 py-1.5 text-[13px] font-semibold shadow-float disabled:opacity-40"
        >
          Send
        </button>
      </form>
      <p className="mt-2.5 text-[12px] leading-4 text-muted">
        Yes is up to {money(range.high)}. No is {money(range.low)}. Or give your own limit.
      </p>
      {error ? (
        <p role="alert" className="mt-3 text-[13px] leading-[18px] text-withheld">
          {error}
        </p>
      ) : null}
    </section>
  );
}
