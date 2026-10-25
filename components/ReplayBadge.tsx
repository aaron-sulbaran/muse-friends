import { copy } from "@/lib/ui/copy";
import type { UiRecording } from "@/lib/ui/types";

/**
 * Live or Replay. The Replay pill is never subtle: a caught fake costs more than
 * a slow call. On the stage it sits once, in the Activity header; a lone phone
 * has no Activity panel, so it shows the short form there. It says what is playing: a real run with the date it was
 * recorded, or the scripted fallback.
 */
export function ReplayBadge({ mode, compact = false, recording }: { mode: "live" | "replay"; compact?: boolean; recording?: UiRecording }) {
  if (mode === "replay") {
    return (
      <span role="status" className="inline-flex items-center gap-2 rounded-full bg-ink px-3 py-1.5 text-[13px] font-semibold text-white">
        {copy.replayBadge(recording, compact)}
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
