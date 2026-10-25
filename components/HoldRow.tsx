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
  /** When it is, as the chat says it ("Tue 6 to 8 PM"); the confirmation row names the plan with it. */
  when?: string;
  /** Prefilled Google Calendar event, or null when there is nothing to prefill. */
  googleUrl: string | null;
  /** A recording is on screen: show the row, but there is no real hold to download. */
  disabled?: boolean;
  /** Which way the hold was already taken, for a row drawn after the fact. */
  initiallyAdded?: CalendarRoute;
};

const pill = "rounded-full bg-group px-3.5 py-2 text-[13px] font-semibold leading-[18px] transition-colors";

/**
 * The calendar hold as a Muse card: the plan's title and two ways to keep it. The .ics works with any calendar; the
 * Google link opens a prefilled event with no sign-in step. Once one is tapped the card has been acted on, so it
 * collapses to a confirmation row (kb/design/marks, "Done cards"): Muse's blue check, "On your calendar", the plan
 * on the line under it, and Change plans at the right. The check and the title are the same link, so a second tap
 * opens the event again.
 */
export function HoldRow({ planId, role, title, googleUrl, when, disabled = false, initiallyAdded }: Props) {
  const [added, setAdded] = useState<CalendarRoute | null>(initiallyAdded ?? null);
  const icsHref = `/api/plans/${planId}/hold.ics?role=${role}`;
  const taken = added === "google" && googleUrl ? "google" : added === "ics" ? "ics" : null;
  // The swap waits one tick, so the browser follows the link that was tapped before the buttons are replaced.
  const take = (route: CalendarRoute) => {
    setTimeout(() => setAdded(route), 0);
  };

  if (taken && !disabled) {
    const detail = when ? `${title}, ${when}` : title;
    const content = (
      <>
        {/* The check draws in after the row has settled: the ring, then the tick. */}
        <CheckMark className="size-5 [&_circle]:[animation-delay:240ms] [&_path]:[animation-delay:400ms]" />
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold leading-5">{copy.holdOnCalendar}</span>
          <span className="line-clamp-2 block text-[13px] leading-[18px] text-muted">{detail}</span>
        </span>
      </>
    );
    const rowLink = "flex min-w-0 flex-1 items-center gap-2.5";
    return (
      <section aria-label={detail} className="flex min-h-14 max-w-[92%] animate-card-in items-center gap-2.5 rounded-[18px] bg-surface py-3 pl-[14px] pr-3 shadow-[0_2px_10px_rgba(0,0,0,0.06)]">
        {taken === "google" && googleUrl ? (
          <a href={googleUrl} target="_blank" rel="noopener noreferrer" className={rowLink}>
            {content}
          </a>
        ) : (
          <a href={icsHref} download="hold.ics" className={rowLink}>
            {content}
          </a>
        )}
        <a
          href={whatsAppUrl(copy.changePlansDraft)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-7 shrink-0 items-center rounded-full bg-group px-3 text-[13px] font-semibold transition-colors hover:bg-bubble-muse"
        >
          {copy.holdChangePlans}
        </a>
      </section>
    );
  }

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
        ) : (
          <>
            <a href={icsHref} download="hold.ics" onClick={() => take("ics")} className={`${pill} hover:bg-bubble-muse`}>
              {copy.holdAction}
            </a>
            {googleUrl ? (
              <a href={googleUrl} target="_blank" rel="noopener noreferrer" onClick={() => take("google")} className={`${pill} hover:bg-bubble-muse`}>
                {copy.holdGoogle}
              </a>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
