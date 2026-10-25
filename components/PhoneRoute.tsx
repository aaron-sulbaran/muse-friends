"use client";

import { useMediaQuery } from "@/lib/ui/use-media-query";
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

  if (!snapshot) return <div className="h-dvh bg-screen" />;

  const screen = <MuseScreen snapshot={snapshot} role={role} framed={framed} onChanged={refresh} />;
  const label = role === "a" ? "Aaron's Muse" : snapshot.simulatedFriend ? "Michelle's Muse, a simulated friend" : "Lisa's Muse";

  if (!framed) {
    return (
      <div className="relative h-dvh">
        {screen}
        {snapshot.mode === "replay" ? (
          <div className="pointer-events-none absolute inset-x-0 top-[max(env(safe-area-inset-top),8px)] flex justify-center">
            <ReplayBadge mode="replay" />
          </div>
        ) : null}
        {!connected ? <p className="absolute inset-x-0 top-1 text-center text-[12px] text-muted">Reconnecting...</p> : null}
      </div>
    );
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-linear-to-b from-surface to-stage-end p-6">
      <div className="h-[min(864px,calc(100dvh-48px))] w-full">
        <FitPhone label={label}>{screen}</FitPhone>
      </div>
    </div>
  );
}
