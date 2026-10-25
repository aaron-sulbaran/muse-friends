import { CalendarPlus } from "lucide-react";
import { copy } from "@/lib/ui/copy";

type Props = {
  planId: string;
  /** The phone's role, so the calendar entry names the other person. */
  role: "a" | "b";
  title: string;
  /** Prefilled Google Calendar event, or null when there is nothing to prefill. */
  googleUrl: string | null;
  /** A recording is on screen: show the row, but there is no real hold to download. */
  disabled?: boolean;
};

const pill = "rounded-full bg-group px-3.5 py-2 text-[13px] font-semibold leading-[18px] transition-colors";

/**
 * The calendar hold as a Muse card: the plan's title and two ways to keep it. The .ics works with any
 * calendar; the Google link opens a prefilled event with no sign-in step.
 */
export function HoldRow({ planId, role, title, googleUrl, disabled = false }: Props) {
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
            <a href={`/api/plans/${planId}/hold.ics?role=${role}`} download="hold.ics" className={`${pill} hover:bg-bubble-muse`}>
              {copy.holdAction}
            </a>
            {googleUrl ? (
              <a href={googleUrl} target="_blank" rel="noopener noreferrer" className={`${pill} hover:bg-bubble-muse`}>
                {copy.holdGoogle}
              </a>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
