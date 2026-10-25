import { CalendarPlus } from "lucide-react";

type Props = {
  planId: string;
  /** The phone's role, so the calendar entry names the other person. */
  role: "a" | "b";
  title: string;
  action: string;
};

/** The calendar hold as a Muse list row; the action downloads hold.ics. */
export function HoldRow({ planId, role, title, action }: Props) {
  return (
    <a
      href={`/api/plans/${planId}/hold.ics?role=${role}`}
      download="hold.ics"
      className="flex max-w-[92%] animate-card-in items-center gap-3 rounded-card bg-surface p-3.5 shadow-float transition-colors hover:bg-group"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-tile bg-group">
        <CalendarPlus className="size-5" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold leading-5">{title}</span>
        <span className="block text-[13px] leading-[18px] text-muted">{action}</span>
      </span>
    </a>
  );
}
