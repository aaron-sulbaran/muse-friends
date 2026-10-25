"use client";

import { CalendarPlus } from "lucide-react";
import { useState } from "react";
import { copy } from "@/lib/ui/copy";
import { whatsAppUrl, type CalendarRoute } from "@/lib/ui/handoff";
import { CheckMark } from "./CheckMark";

type Props = {
  planId: string;
  /** The phone's role, so the calendar entry names the other person. */
  role: "a" | "b";
  title: string;
  /** Prefilled Google Calendar event, or null when there is nothing to prefill. */
  googleUrl: string | null;
  /** A recording is on screen: show the row, but there is no real hold to download. */
  disabled?: boolean;
  /** Which way the hold was already taken, for a row drawn after the fact. */
  initiallyAdded?: CalendarRoute;
};

const pill = "rounded-full bg-group px-3.5 py-2 text-[13px] font-semibold leading-[18px] transition-colors";

/**
 * The calendar hold as a Muse card: the plan's title and two ways to keep it. The .ics works with any
 * calendar; the Google link opens a prefilled event with no sign-in step. Once one is tapped the row says
 * what happened and keeps that link for a second tap, with Change plans beside it.
 */
export function HoldRow({ planId, role, title, googleUrl, disabled = false, initiallyAdded }: Props) {
  const [added, setAdded] = useState<CalendarRoute | null>(initiallyAdded ?? null);
  const icsHref = `/api/plans/${planId}/hold.ics?role=${role}`;
  const taken = added === "google" && googleUrl ? "google" : added === "ics" ? "ics" : null;

  return (
    <section aria-label={title} className="max-w-[92%] animate-card-in rounded-card bg-surface p-3.5 shadow-float">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-tile bg-group">
          <CalendarPlus className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <p className="min-w-0 text-[15px] font-semibold leading-5">{title}</p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {disabled ? (
          <>
            <span className={`${pill} opacity-50`}>{copy.holdAction}</span>
            {googleUrl ? <span className={`${pill} opacity-50`}>{copy.holdGoogle}</span> : null}
          </>
        ) : taken ? (
          <>
            {taken === "google" && googleUrl ? (
              <a href={googleUrl} target="_blank" rel="noopener noreferrer" className={`${pill} inline-flex items-center gap-1.5 hover:bg-bubble-muse`}>
                <CheckMark />
                {copy.holdAdded}
              </a>
            ) : (
              <a href={icsHref} download="hold.ics" className={`${pill} inline-flex items-center gap-1.5 hover:bg-bubble-muse`}>
                <CheckMark />
                {copy.holdAdded}
              </a>
            )}
            <a
              href={whatsAppUrl(copy.changePlansDraft)}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full border border-bezel-line px-3.5 py-2 text-[13px] font-semibold leading-[18px] transition-colors hover:bg-group"
            >
              {copy.holdChangePlans}
            </a>
          </>
        ) : (
          <>
            <a href={icsHref} download="hold.ics" onClick={() => setAdded("ics")} className={`${pill} hover:bg-bubble-muse`}>
              {copy.holdAction}
            </a>
            {googleUrl ? (
              <a href={googleUrl} target="_blank" rel="noopener noreferrer" onClick={() => setAdded("google")} className={`${pill} hover:bg-bubble-muse`}>
                {copy.holdGoogle}
              </a>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
