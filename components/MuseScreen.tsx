"use client";

import { Activity, ArrowLeftRight, BatteryFull, Shield, Signal, Wallet, Wifi } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { viewForRole, type ChatItem } from "@/lib/ui/chat";
import { copy } from "@/lib/ui/copy";
import { otherRole, sideHref } from "@/lib/ui/entry";
import { formatStatusBarTime, namesFor } from "@/lib/ui/format";
import { postDecision, postHandoff, postReplan } from "@/lib/ui/actions";
import type { GoalContext } from "@/lib/ui/goals";
import type { Role, UiPayment, UiSnapshot } from "@/lib/ui/types";
import { ChatBubble, DaySeparator, TypingDots } from "./ChatBubble";
import { AgreedLine } from "./AgreedLine";
import { AvatarSheet } from "./AvatarSheet";
import { DraftCard } from "./DraftCard";
import { GoalDetail, GoalsTab } from "./GoalsTab";
import { HoldRow } from "./HoldRow";
import { MuseAvatar } from "./MuseAvatar";
import { PaymentCard } from "./PaymentCard";
import { OutcomeReplies } from "./OutcomeReplies";
import { ReelCard } from "./ReelCard";
import { RecommendationCard } from "./RecommendationCard";
import { SettleCard } from "./SettleCard";
import { ReplayBadge } from "./ReplayBadge";
import { StartCard } from "./StartCard";
import { StatusPill } from "./StatusPill";
import { TabBar, type Tab } from "./TabBar";
import { WalletChip } from "./WalletChip";

type Props = {
  snapshot: UiSnapshot;
  role: Role;
  /** True inside a phone bezel (shows the status bar); false when the screen is the whole page. */
  framed: boolean;
  /** Called after an action so the caller can refresh the snapshot at once. */
  onChanged: () => void;
  /** True while a recording is on screen: nothing here may touch live state. */
  readOnly?: boolean;
  /** A run could not start because the live-run caps are reached; the page falls back to a recording. */
  onPaused?: (text: string) => void;
  /** Opens a payment's ledger ids in the page's drawer; without it a payment card has no Details link. */
  onOpenPayment?: (payment: UiPayment) => void;
  /**
   * Set when this screen is a phone on its own (the stage has the Activity panel and the other phone beside
   * it): adds a row to switch sides and open Activity as a sheet, whose content the page supplies.
   */
  standalone?: { activity: (close: () => void) => React.ReactNode };
};

function StatusBar({ time }: { time: string }) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between px-8 text-[15px] font-semibold" aria-hidden="true">
      <span>{time}</span>
      <span className="flex items-center gap-1.5">
        <Signal className="size-4" strokeWidth={2} />
        <Wifi className="size-4" strokeWidth={2} />
        <BatteryFull className="size-5" strokeWidth={1.75} />
      </span>
    </div>
  );
}

function spacingBefore(previous: ChatItem | undefined, item: ChatItem): string {
  if (!previous) return "";
  const sameSpeaker = previous.kind === "bubble" && item.kind === "bubble" && previous.from === item.from;
  return sameSpeaker ? "mt-1.5" : "mt-3.5";
}

type StandaloneBarProps = { snapshot: UiSnapshot; role: Role; onOpenActivity: () => void };

/** Switch to the other side, see the recording badge, open Activity: what the stage gives a judge for free and a lone phone has to carry. */
function StandaloneBar({ snapshot, role, onOpenActivity }: StandaloneBarProps) {
  const other = otherRole(role);
  const otherName = namesFor(snapshot).human[other === "a" ? "aaron" : "lisa"];
  return (
    <div className="flex h-10 shrink-0 items-center justify-between gap-2 px-4">
      <Link
        href={sideHref(other)}
        aria-label={copy.switchSideLabel(otherName)}
        className="inline-flex h-9 min-w-0 items-center gap-1.5 rounded-full bg-group px-3 text-[13px] font-semibold transition-colors hover:bg-bubble-muse"
      >
        <ArrowLeftRight className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        <span className="truncate">{copy.switchSide(otherName)}</span>
      </Link>
      <div className="flex shrink-0 items-center gap-2">
        {snapshot.mode === "replay" ? <ReplayBadge mode="replay" compact /> : null}
        <button
          type="button"
          onClick={onOpenActivity}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-group px-3 text-[13px] font-semibold transition-colors hover:bg-bubble-muse"
        >
          <Activity className="size-4" strokeWidth={1.75} aria-hidden="true" />
          {copy.activityOpen}
        </button>
      </div>
    </div>
  );
}

/** One Muse phone's screen: avatar and status on top, the chat, and the tab bar. */
export function MuseScreen({ snapshot, role, framed, onChanged, readOnly = false, onPaused, onOpenPayment, standalone }: Props) {
  const view = viewForRole(snapshot, role);
  const [pending, setPending] = useState(false);
  const [replanError, setReplanError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  const [goalOpen, setGoalOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const chatContent = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const thinking = snapshot.inFlight?.agent === view.agent;
  const simulated = snapshot.simulatedFriend;
  const names = namesFor(snapshot);
  const goalContext: GoalContext = {
    friend: view.friendHumanName,
    reelOwner: role === "a" ? `${view.friendHumanName}'s` : "your",
    muses: [names.muse.aaron, names.muse.lisa],
  };

  // The first scroll lands at the latest message at once; later ones glide.
  const scrolledOnce = useRef(false);
  useEffect(() => {
    if (tab !== "chat") {
      scrolledOnce.current = false;
      return;
    }
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: scrolledOnce.current ? "smooth" : "auto" });
    scrolledOnce.current = true;
  }, [view.items.length, thinking, tab]);

  // Something in the chat grew after it was laid out (a reel's embed arriving): a reader who was at the end stays there.
  useEffect(() => {
    const content = chatContent.current;
    if (tab !== "chat" || !content) return;
    const observer = new ResizeObserver(() => {
      const element = scroller.current;
      if (element && nearBottom.current) element.scrollTo({ top: element.scrollHeight, behavior: "auto" });
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [tab]);

  async function decide(planId: string, choice: "accept" | "decline") {
    if (readOnly) return;
    setPending(true);
    await postDecision(planId, role, choice);
    setPending(false);
    onChanged();
  }

  async function replan(planId: string) {
    if (readOnly) return;
    setPending(true);
    setReplanError(null);
    const result = await postReplan(planId, role);
    setPending(false);
    if (!result.ok && result.paused) onPaused?.(result.message);
    else if (!result.ok) setReplanError(result.message);
    onChanged();
  }

  async function handoff(planId: string, via: "whatsapp" | "copy") {
    if (readOnly) return;
    await postHandoff(planId, role, via);
    onChanged();
  }

  function renderItem(item: ChatItem) {
    switch (item.kind) {
      case "separator":
        return <DaySeparator day={item.day} time={item.time} />;
      case "bubble":
        return <ChatBubble from={item.from}>{item.text}</ChatBubble>;
      case "collapsed":
        return (
          <p className="animate-fade-in text-[13px] leading-[18px] text-muted" style={{ paddingLeft: 4 }}>
            {item.text}
          </p>
        );
      case "plan-card":
        return (
          <RecommendationCard
            plan={item.plan}
            role={role}
            view={view}
            simulatedFriend={simulated}
            pending={pending || readOnly}
            onDecide={(choice) => decide(item.plan.id, choice)}
            onReplan={() => replan(item.plan.id)}
            error={replanError}
          />
        );
      case "draft-card":
        return <DraftCard draft={item.draft} onHandoff={(via) => handoff(item.plan.id, via)} />;
      case "start-card":
        return <StartCard variant={item.variant} friendName={item.friendName} onChanged={onChanged} readOnly={readOnly} onPaused={onPaused} />;
      case "reel-card":
        return <ReelCard image={item.image} poster={item.poster} caption={item.caption} place={item.place} permalink={item.permalink} align={item.align} label={item.live ? copy.reelLiveLabel : copy.reelLabel} />;
      case "agreed-line":
        // On the stage, Activity already sits between the phones; a phone on its own opens it as a sheet.
        return standalone ? <AgreedLine first={item.first} second={item.second} count={item.count} onOpen={() => setActivityOpen(true)} /> : null;
      case "outcome-replies":
        return <OutcomeReplies planId={item.planId} role={role} onChanged={onChanged} readOnly={readOnly} />;
      case "hold-row":
        return <HoldRow planId={item.planId} role={role} title={item.title} googleUrl={item.googleUrl} disabled={readOnly} />;
      case "payment-card":
        return <PaymentCard payment={item.payment} side={item.side} friendName={item.friendName} friendMuse={item.friendMuse} onOpen={onOpenPayment} />;
      case "settle-card":
        return (
          <SettleCard
            planId={item.planId}
            role={role}
            offer={item.offer}
            friendName={item.friendName}
            friendMuse={item.friendMuse}
            paymentCount={snapshot.payments.length}
            readOnly={readOnly}
            onChanged={onChanged}
            onPaused={onPaused}
            onOpenSettings={() => setSheetOpen(true)}
          />
        );
    }
  }

  // Side a has no sharing switches, but it still has a wallet: a payments button opens the same sheet, payments only.
  const paymentsOnA = role === "a" && !readOnly && snapshot.sandbox.enabled;

  return (
    <div className="relative flex h-full flex-col bg-screen">
      {framed ? <StatusBar time={formatStatusBarTime(snapshot.now)} /> : <div className="h-[env(safe-area-inset-top)] shrink-0" />}
      {standalone ? <StandaloneBar snapshot={snapshot} role={role} onOpenActivity={() => setActivityOpen(true)} /> : null}
      {simulated && role === "b" ? (
        <p className="shrink-0 bg-group px-4 py-2 text-center text-[13px] font-semibold">{copy.simulatedFriendBanner}</p>
      ) : null}
      {tab === "chat" ? (
        <>
          <header className="relative flex shrink-0 flex-col items-center gap-1.5 pb-3 pt-2">
            {role === "b" && !readOnly ? (
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                aria-label={`Open ${view.museName} settings`}
                className="rounded-full transition-transform hover:scale-105"
              >
                <MuseAvatar agent={view.agent} simulated={simulated && view.agent === "lisa"} name={view.museName} size={44} mood={view.mood} />
              </button>
            ) : (
              <MuseAvatar agent={view.agent} simulated={simulated && view.agent === "lisa"} name={view.museName} size={44} mood={view.mood} />
            )}
            <StatusPill name={view.museName} status={view.status} />
            <WalletChip snapshot={snapshot} agent={view.agent} />
            {role === "b" && !readOnly ? (
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                aria-label={`${view.museName} sharing with ${view.friendMuseName}`}
                className="absolute right-4 top-2 grid size-9 place-items-center rounded-full bg-group transition-colors hover:bg-bubble-muse"
              >
                <Shield className="size-5" strokeWidth={1.75} aria-hidden="true" />
              </button>
            ) : null}
            {paymentsOnA ? (
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                aria-label={`${view.museName} payments`}
                className="absolute right-4 top-2 grid size-9 place-items-center rounded-full bg-group transition-colors hover:bg-bubble-muse"
              >
                <Wallet className="size-5" strokeWidth={1.75} aria-hidden="true" />
              </button>
            ) : null}
          </header>
          <div
            ref={scroller}
            onScroll={(event) => {
              const element = event.currentTarget;
              nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
            }}
            className="quiet-scroll flex-1 overflow-y-auto px-4 pb-28 [mask-image:linear-gradient(to_bottom,transparent,black_14px)]">
            <div ref={chatContent} className="flex flex-col">
              {view.items.map((item, index) => (
                <div key={item.id} className={spacingBefore(view.items[index - 1], item)}>
                  {renderItem(item)}
                </div>
              ))}
              {thinking ? (
                <div className="mt-3.5">
                  <TypingDots />
                </div>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <div className="quiet-scroll flex-1 overflow-y-auto">
          {goalOpen && snapshot.plan ? (
            <GoalDetail plan={snapshot.plan} context={goalContext} onBack={() => setGoalOpen(false)} />
          ) : (
            <GoalsTab plan={snapshot.plan} context={goalContext} onOpen={() => setGoalOpen(true)} />
          )}
        </div>
      )}
      <TabBar
        tab={tab}
        onSelect={(next) => {
          setTab(next);
          setGoalOpen(false);
        }}
      />
      {activityOpen && standalone ? (
        <div
          className="absolute inset-0 z-30 flex items-end bg-black/10"
          onClick={(event) => {
            if (event.target === event.currentTarget) setActivityOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") setActivityOpen(false);
          }}
        >
          <div role="dialog" aria-modal="true" aria-label={copy.activityTitle} className="h-[88%] w-full animate-card-in overflow-hidden rounded-t-card shadow-float">
            {standalone.activity(() => setActivityOpen(false))}
          </div>
        </div>
      ) : null}
      {sheetOpen && (role === "b" || paymentsOnA) ? (
        <AvatarSheet
          role={role}
          simulated={simulated}
          museName={view.museName}
          friendMuseName={view.friendMuseName}
          sharing={role === "b" ? snapshot.sharing.lisa : undefined}
          payments={snapshot.sandbox.enabled ? snapshot.paymentsScope[view.agent] : undefined}
          onChanged={onChanged}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}
