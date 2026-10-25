"use client";

import { useCallback, useState } from "react";
import { namesFor } from "@/lib/ui/format";
import { useMediaQuery } from "@/lib/ui/use-media-query";
import { useReplay } from "@/lib/ui/use-replay";
import { useSimulatedFriend } from "@/lib/ui/use-simulated-friend";
import { useSnapshot } from "@/lib/ui/use-snapshot";
import type { Role } from "@/lib/ui/types";
import { MuseScreen } from "./MuseScreen";
import { PausedNotice } from "./PausedNotice";
import { FitPhone } from "./PhoneFrame";
import { ReplayBadge } from "./ReplayBadge";

/**
 * One phone alone, for a judge's own device. Under 600px the screen is the
 * whole page; wider, it sits in the bezel on the stage gradient.
 */
export function PhoneRoute({ role }: { role: Role }) {
  const live = useSnapshot();
  const replay = useReplay();
  const { refresh } = live;
  // A recording stands in for the live snapshot while it plays, and nothing on screen may act on live state.
  const snapshot = replay.active ? replay.snapshot : live.snapshot;
  const connected = replay.active ? true : live.connected;
  const framed = useMediaQuery("(min-width: 600px)");
  const [pausedText, setPausedText] = useState<string | null>(null);
  const startReplay = replay.start;
  const pause = useCallback(
    (text: string) => {
      setPausedText(text);
      void startReplay();
    },
    [startReplay],
  );
  useSimulatedFriend(live.snapshot, refresh, !replay.active, pause);

  if (!snapshot) return <div className="h-dvh bg-screen" />;

  const screen = <MuseScreen snapshot={snapshot} role={role} framed={framed} onChanged={refresh} readOnly={replay.active} onPaused={pause} />;
  const notice =
    pausedText !== null && replay.active ? (
      <PausedNotice
        text={pausedText}
        onBack={() => {
          replay.stop();
          setPausedText(null);
        }}
        className="absolute inset-x-3 bottom-[84px] z-40"
      />
    ) : null;
  const names = namesFor(snapshot);
  const label = role === "a" ? `${names.muse.aaron}'s side` : snapshot.simulatedFriend ? `${names.muse.lisa}, a simulated friend` : `${names.muse.lisa}'s side`;

  if (!framed) {
    return (
      <div className="relative h-dvh">
        {screen}
        {notice}
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
      {notice ? <div className="absolute left-1/2 top-4 -translate-x-1/2">{notice}</div> : null}
    </div>
  );
}
