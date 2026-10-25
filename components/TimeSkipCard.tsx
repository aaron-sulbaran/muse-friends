import { FastForward } from "lucide-react";
import { copy } from "@/lib/ui/copy";

/**
 * The time skip in the chat: a centered card, "Skipping ahead to Tuesday, 4:00 PM", labeled as simulated time, so a
 * jump of a day reads as the demo moving on, not as something lost. It pops in; under reduced motion it fades.
 */
export function TimeSkipCard({ day, time }: { day: string; time: string }) {
  return (
    <div role="status" className="flex animate-skip-in flex-col items-center gap-1 py-1">
      <p className="inline-flex items-center gap-2 rounded-full bg-group px-4 py-2 text-[13px] leading-[18px] shadow-float">
        <FastForward className="size-4 shrink-0 text-accent" strokeWidth={1.75} fill="currentColor" aria-hidden="true" />
        <span>
          {copy.skipAhead} <span className="font-semibold">{day}</span>, {time}
        </span>
      </p>
      <p className="text-[11px] font-semibold uppercase leading-4 tracking-[0.06em] text-muted">{copy.skipLabel}</p>
    </div>
  );
}
