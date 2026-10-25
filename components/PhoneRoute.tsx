"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { postSimulatedFriend } from "@/lib/ui/actions";
import { copy } from "@/lib/ui/copy";
import { runInProgress, wantsSimulatedFriend } from "@/lib/ui/entry";
import { namesFor } from "@/lib/ui/format";
import { useMediaQuery } from "@/lib/ui/use-media-query";
import { useReplay } from "@/lib/ui/use-replay";
import { useSimulatedFriend } from "@/lib/ui/use-simulated-friend";
import { useSnapshot } from "@/lib/ui/use-snapshot";
import type { Role, UiMessage, UiPayment } from "@/lib/ui/types";
import { ActivityPanel } from "./ActivityPanel";
import { JsonDrawer } from "./JsonDrawer";
import { MuseScreen } from "./MuseScreen";
import { PausedNotice } from "./PausedNotice";
import { PaymentDrawer } from "./PaymentDrawer";
import { FitPhone } from "./PhoneFrame";

/**
 * One phone alone, for a judge's own device. Under 600px the screen is the
 * whole page; wider, it sits in the bezel on the stage gradient. With no Activity
 * panel beside it, Activity opens as a sheet from the phone, and a pill switches sides.
 * Arriving at /a with the simulated-friend flag (the chooser's third option) starts that game once.
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
  const stopReplay = replay.stop;
  const backToLive = useCallback(() => {
    stopReplay();
    setPausedText(null);
  }, [stopReplay]);
  const [openMessage, setOpenMessage] = useState<UiMessage | null>(null);
  const [openPayment, setOpenPayment] = useState<UiPayment | null>(null);

  const arrivedForFriend = useRef(false);
  const startedFriend = useRef(false);
  useEffect(() => {
    if (role !== "a" || !wantsSimulatedFriend(window.location.search)) return;
    arrivedForFriend.current = true;
    window.history.replaceState(null, "", window.location.pathname);
  }, [role]);
  const liveSnapshot = live.snapshot;
  useEffect(() => {
    if (!arrivedForFriend.current || startedFriend.current || !liveSnapshot) return;
    startedFriend.current = true;
    // A run still going in the room is shown as it is, not wiped; the start card stays available if this fails.
    if (runInProgress(liveSnapshot.plan)) return;
    void postSimulatedFriend().then((result) => {
      if (!result.ok && result.paused) pause(result.message);
      refresh();
    });
  }, [liveSnapshot, pause, refresh]);

  if (!snapshot) return <div className="h-dvh bg-screen" />;

  const names = namesFor(snapshot);
  const screen = (
    <MuseScreen
      snapshot={snapshot}
      role={role}
      framed={framed}
      onChanged={refresh}
      readOnly={replay.active}
      onPaused={pause}
      onOpenPayment={setOpenPayment}
      standalone={{
        activity: (close) => (
          <ActivityPanel
            snapshot={snapshot}
            connected={connected}
            onOpenMessage={setOpenMessage}
            onClose={close}
            footer={
              <>
                <button
                  type="button"
                  onClick={replay.active ? backToLive : () => void replay.start()}
                  className="w-full rounded-full bg-group px-4 py-2.5 text-[15px] font-semibold transition-colors hover:bg-bubble-muse"
                >
                  {replay.active ? copy.pausedBack : copy.replayStart}
                </button>
                {replay.error ? (
                  <p role="alert" className="mt-2 text-center text-[13px] leading-[18px] text-withheld">
                    {replay.error}
                  </p>
                ) : null}
              </>
            }
          />
        ),
      }}
    />
  );
  const drawer = (
    <>
      <JsonDrawer message={openMessage} budget={liveSnapshot?.budget ?? null} names={names} onClose={() => setOpenMessage(null)} />
      {liveSnapshot ? <PaymentDrawer payment={openPayment} wallets={liveSnapshot.wallets} names={liveSnapshot.sides} onClose={() => setOpenPayment(null)} /> : null}
    </>
  );
  const notice =
    pausedText !== null && replay.active ? (
      <PausedNotice
        text={pausedText}
        onBack={backToLive}
        className="absolute inset-x-3 bottom-[84px] z-40"
      />
    ) : null;
  const label = role === "a" ? `${names.muse.aaron}'s side` : snapshot.simulatedFriend ? `${names.muse.lisa}, a simulated friend` : `${names.muse.lisa}'s side`;

  if (!framed) {
    return (
      <div className="relative h-dvh">
        {screen}
        {notice}
        {!connected ? <p className="absolute inset-x-0 top-1 text-center text-[12px] text-muted">Reconnecting...</p> : null}
        {drawer}
      </div>
    );
  }

  return (
    <div className="relative grid min-h-dvh place-items-center bg-linear-to-b from-surface to-stage-end p-6">
      <div className="h-[min(864px,calc(100dvh-48px))] w-full">
        <FitPhone label={label}>{screen}</FitPhone>
      </div>
      {notice ? <div className="absolute left-1/2 top-4 -translate-x-1/2">{notice}</div> : null}
      {drawer}
    </div>
  );
}
