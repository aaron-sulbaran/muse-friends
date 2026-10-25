import { copy } from "@/lib/ui/copy";
import type { UiSnapshot } from "@/lib/ui/types";
import { FollowThroughCounter } from "./FollowThroughCounter";

export function TopBar({ snapshot }: { snapshot: UiSnapshot | null }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between px-6 min-[900px]:px-12">
      <div className="flex items-center gap-3">
        <h1>
          {/* A fixed vector asset from the brand kit; next/image would add nothing here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wordmark/muse-friends-wordmark.svg" alt={copy.brand} className="h-[30px] w-auto" />
        </h1>
        <p className="hidden text-[13px] leading-[18px] text-muted min-[600px]:block">{copy.tagline}</p>
      </div>
      <FollowThroughCounter followThrough={snapshot?.followThrough ?? { events: [], agentMessageCount: 0, humanTapCount: 0 }} />
    </header>
  );
}
