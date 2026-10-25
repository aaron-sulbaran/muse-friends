import { copy } from "@/lib/ui/copy";

/** Live or Replay. The Replay pill is never subtle: a caught fake costs more than a slow call. */
export function ReplayBadge({ mode }: { mode: "live" | "replay" }) {
  if (mode === "replay") {
    return (
      <span role="status" className="inline-flex items-center gap-2 rounded-full bg-ink px-3 py-1.5 text-[13px] font-semibold text-white">
        {copy.replayLabel}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-[13px] font-semibold shadow-float">
      <span aria-hidden="true" className="size-2 rounded-full bg-tracking" />
      {copy.liveLabel}
    </span>
  );
}
