"use client";

import { namesFor } from "@/lib/ui/format";
import { useMediaQuery } from "@/lib/ui/use-media-query";
import { useSimulatedFriend } from "@/lib/ui/use-simulated-friend";
import { useSnapshot } from "@/lib/ui/use-snapshot";
import type { Role } from "@/lib/ui/types";
import { MuseScreen } from "./MuseScreen";
import { FitPhone } from "./PhoneFrame";
import { ReplayBadge } from "./ReplayBadge";

/**
 * One phone alone, for a judge's own device. Under 600px the screen is the
 * whole page; wider, it sits in the bezel on the stage gradient.
 */
export function PhoneRoute({ role }: { role: Role }) {
  const { snapshot, connected, refresh } = useSnapshot();
  const framed = useMediaQuery("(min-width: 600px)");
  useSimulatedFriend(snapshot, refresh);

  if (!snapshot) return <div className="h-dvh bg-screen" />;

  const screen = <MuseScreen snapshot={snapshot} role={role} framed={framed} onChanged={refresh} />;
  const names = namesFor(snapshot);
  const label = role === "a" ? `${names.muse.aaron}'s side` : snapshot.simulatedFriend ? `${names.muse.lisa}, a simulated friend` : snapshot.standIn ? names.muse.lisa : `${names.muse.lisa}'s side`;

  if (!framed) {
    return (
      <div className="relative h-dvh">
        {screen}
        {snapshot.mode === "replay" ? (
          <div className="pointer-events-none absolute left-3 top-[max(env(safe-area-inset-top),8px)]">
            <ReplayBadge mode="replay" compact />
          </div>
        ) : null}
        {!connected ? <p className="absolute inset-x-0 top-1 text-center text-[12px] text-muted">Reconnecting...</p> : null}
      </div>
    );
  }

  return (
    <div className="relative grid min-h-dvh place-items-center bg-linear-to-b from-surface to-stage-end p-6">
      {snapshot.mode === "replay" ? (
        <div className="absolute left-6 top-4">
          <ReplayBadge mode="replay" compact />
        </div>
      ) : null}
      <div className="h-[min(864px,calc(100dvh-48px))] w-full">
        <FitPhone label={label}>{screen}</FitPhone>
      </div>
    </div>
  );
}
