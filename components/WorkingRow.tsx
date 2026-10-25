"use client";

import { copy } from "@/lib/ui/copy";
import { listOf, type Names } from "@/lib/ui/format";
import type { MemberId, UiSnapshot } from "@/lib/ui/types";
import { Elapsed } from "./Elapsed";
import { MuseAvatar } from "./MuseAvatar";

type Props = {
  snapshot: Pick<UiSnapshot, "inFlight" | "mode">;
  names: Names;
  initials: Record<MemberId, string | null>;
  /** Start the count this many seconds in, for a card drawn after the fact. */
  initialSeconds?: number;
};

/**
 * The row for a model call that is running: "Sprout is working, 7 s", counting up each second beside the Muse's own chip
 * with a soft pulse, like a coding agent's working line. It is replaced by the real row when the message lands, which
 * says how long the call took. The count starts when the snapshot says the call started (`since`), or from the first poll
 * that showed it. A replay plays back what was recorded, so it never counts live.
 */
export function WorkingRow({ snapshot, names, initials, initialSeconds }: Props) {
  if (!snapshot.inFlight) return null;
  const { agent, agents } = snapshot.inFlight;
  const live = snapshot.mode !== "replay";
  return (
    <li className="animate-row-in">
      <div role="status" className="flex items-center gap-3 rounded-group bg-group px-3 py-2.5">
        <span className="animate-working-pulse rounded-full">
          <MuseAvatar agent={agent} initial={initials[agent]} name={names.muse[agent]} size={36} />
        </span>
        <span className="text-[15px] leading-5">
          {(snapshot.inFlight.payment ? copy.settlingUp : copy.working)(listOf(agents.map((member) => names.muse[member])), agents.length)}
          {live ? (
            <>
              , <Elapsed flight={snapshot.inFlight} initialSeconds={initialSeconds} />
            </>
          ) : null}
        </span>
      </div>
    </li>
  );
}
