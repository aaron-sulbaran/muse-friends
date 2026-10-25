"use client";

import { useCallback, useState } from "react";
import { copy } from "@/lib/ui/copy";
import { formatClockLabel, namesFor } from "@/lib/ui/format";
import { useReplay } from "@/lib/ui/use-replay";
import { useSimulatedFriend } from "@/lib/ui/use-simulated-friend";
import { useSnapshot } from "@/lib/ui/use-snapshot";
import type { UiMessage } from "@/lib/ui/types";
import { ActivityPanel } from "./ActivityPanel";
import { DemoControls } from "./DemoControls";
import { FitPhone } from "./PhoneFrame";
import { JsonDrawer } from "./JsonDrawer";
import { MuseScreen } from "./MuseScreen";
import { PausedNotice } from "./PausedNotice";
import { TopBar } from "./TopBar";

/** The laptop stage: Phone A, the Activity panel, Phone B, with the presenter controls underneath. */
export function Stage() {
  const live = useSnapshot();
  const replay = useReplay();
  // A recording stands in for the live snapshot while it plays, and nothing on screen may act on live state.
  const snapshot = replay.active ? replay.snapshot : live.snapshot;
  const { refresh } = live;
  const connected = replay.active ? true : live.connected;
  const [pausedText, setPausedText] = useState<string | null>(null);
  const startReplay = replay.start;
  // Past the live-run caps the stage plays a recording and says why, with a way back; it is never an error.
  const pause = useCallback(
    (text: string) => {
      setPausedText(text);
      void startReplay();
    },
    [startReplay],
  );
  useSimulatedFriend(live.snapshot, refresh, !replay.active, pause);
  const [openMessage, setOpenMessage] = useState<UiMessage | null>(null);
  const showPaused = pausedText !== null && replay.active;
  const names = snapshot ? namesFor(snapshot) : null;

  return (
    <div className="flex min-h-dvh flex-col bg-linear-to-b from-surface to-stage-end">
      <TopBar snapshot={snapshot} />
      {showPaused ? (
        <PausedNotice
          text={pausedText}
          onBack={() => {
            replay.stop();
            setPausedText(null);
          }}
          className="mx-4 mb-2 min-[900px]:mx-12"
        />
      ) : null}
      <main
        style={{ "--chrome": showPaused ? "152px" : "104px" } as React.CSSProperties}
        className="grid flex-1 grid-cols-1 gap-6 px-4 pb-4 min-[600px]:grid-cols-2 min-[900px]:h-[calc(100dvh-var(--chrome))] min-[900px]:flex-none min-[900px]:grid-cols-[minmax(0,1fr)_minmax(440px,520px)_minmax(0,1fr)] min-[900px]:gap-10 min-[900px]:px-12">
        <div className="h-[640px] min-h-0 min-[900px]:order-1 min-[900px]:h-full">
          {snapshot ? (
            <FitPhone label={`${names?.muse.aaron ?? "Sprout"}'s side`}>
              <MuseScreen snapshot={snapshot} role="a" framed onChanged={refresh} readOnly={replay.active} onPaused={pause} />
            </FitPhone>
          ) : null}
        </div>
        <div className="h-[640px] min-h-0 min-[600px]:order-3 min-[600px]:col-span-2 min-[900px]:order-2 min-[900px]:col-span-1 min-[900px]:h-full">
          <ActivityPanel snapshot={snapshot} connected={connected} onOpenMessage={setOpenMessage} />
        </div>
        <div className="h-[640px] min-h-0 min-[600px]:order-2 min-[900px]:order-3 min-[900px]:h-full">
          {snapshot ? (
            <FitPhone label={snapshot.simulatedFriend ? `${names?.muse.lisa}, a simulated friend` : `${names?.muse.lisa}'s side`}>
              <MuseScreen snapshot={snapshot} role="b" framed onChanged={refresh} readOnly={replay.active} onPaused={pause} />
            </FitPhone>
          ) : null}
        </div>
      </main>
      <footer className="flex h-12 shrink-0 items-center justify-between px-6 min-[900px]:px-12">
        <DemoControls snapshot={snapshot} onChanged={refresh} replay={replay} onPaused={pause} />
        {snapshot?.clockSimulated ? (
          <p className="text-[13px] leading-[18px] text-muted">
            {copy.simulatedClock}: {formatClockLabel(snapshot.now)}
          </p>
        ) : null}
      </footer>
      <JsonDrawer
        message={openMessage}
        budget={live.snapshot?.budget ?? null}
        names={names ?? { muse: { aaron: "", lisa: "" }, human: { aaron: "", lisa: "" } }}
        onClose={() => setOpenMessage(null)}
      />
    </div>
  );
}
