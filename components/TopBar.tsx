import { copy } from "@/lib/ui/copy";
import type { UiSnapshot } from "@/lib/ui/types";
import { FollowThroughCounter } from "./FollowThroughCounter";
import { MuseAvatar } from "./MuseAvatar";
import { ReplayBadge } from "./ReplayBadge";

/** The two Muses side by side: the mark says "two Muses" without a new symbol. */
function Mark() {
  return (
    <span className="flex items-center" aria-hidden="true">
      <MuseAvatar agent="aaron" size={28} className="relative z-10 ring-2 ring-surface" />
      <MuseAvatar agent="lisa" size={28} className="-ml-2.5" />
    </span>
  );
}

export function TopBar({ snapshot }: { snapshot: UiSnapshot | null }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between px-6 min-[900px]:px-12">
      <div className="flex items-center gap-3">
        <Mark />
        <div className="flex flex-col min-[600px]:flex-row min-[600px]:items-baseline min-[600px]:gap-3">
          <h1 className="text-[17px] font-semibold leading-[22px]">{copy.brand}</h1>
          <p className="text-[13px] leading-[18px] text-muted">{copy.tagline}</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <FollowThroughCounter followThrough={snapshot?.followThrough ?? { events: [], agentMessageCount: 0 }} />
        {snapshot ? <ReplayBadge mode={snapshot.mode} /> : null}
      </div>
    </header>
  );
}
