"use client";

import { BatteryFull, Shield, Signal, Users, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { viewForRole, type ChatItem } from "@/lib/ui/chat";
import { copy } from "@/lib/ui/copy";
import { discInitials, formatStatusBarTime, namesFor } from "@/lib/ui/format";
import { postDecision, postHandoff } from "@/lib/ui/actions";
import type { GoalContext } from "@/lib/ui/goals";
import type { Role, UiSnapshot } from "@/lib/ui/types";
import { ChatBubble, DaySeparator, TypingDots } from "./ChatBubble";
import { AvatarSheet } from "./AvatarSheet";
import { ContactSheet } from "./ContactSheet";
import { DraftCard } from "./DraftCard";
import { GoalDetail, GoalsTab } from "./GoalsTab";
import { HoldRow } from "./HoldRow";
import { MuseAvatar } from "./MuseAvatar";
import { RecommendationCard } from "./RecommendationCard";
import { StartCard } from "./StartCard";
import { StatusPill } from "./StatusPill";
import { TabBar, type Tab } from "./TabBar";

type Props = {
  snapshot: UiSnapshot;
  role: Role;
  /** True inside a phone bezel (shows the status bar); false when the screen is the whole page. */
  framed: boolean;
  /** Called after an action so the caller can refresh the snapshot at once. */
  onChanged: () => void;
  /** True while a recording is on screen: nothing here may touch live state. */
  readOnly?: boolean;
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

/** One Muse phone's screen: avatar and status on top, the chat, and the tab bar. */
export function MuseScreen({ snapshot, role, framed, onChanged, readOnly = false }: Props) {
  const view = viewForRole(snapshot, role);
  const [pending, setPending] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  const [goalOpen, setGoalOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const thinking = snapshot.inFlight?.agent === view.agent;
  const simulated = snapshot.simulatedFriend;
  const names = namesFor(snapshot);
  const initials = discInitials(snapshot);
  const goalContext: GoalContext = {
    friend: view.friendHumanName,
    reelOwner: role === "a" ? `${view.friendHumanName}'s` : "your",
    muses: [names.muse.aaron, names.muse.lisa],
  };

  useEffect(() => {
    if (tab !== "chat") return;
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [view.items.length, thinking, tab]);

  async function decide(planId: string, choice: "accept" | "decline") {
    if (readOnly) return;
    setPending(true);
    await postDecision(planId, role, choice);
    setPending(false);
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
            friendInitial={initials[view.friend]}
            pending={pending || readOnly}
            onDecide={(choice) => decide(item.plan.id, choice)}
          />
        );
      case "draft-card":
        return <DraftCard draft={item.draft} onHandoff={(via) => handoff(item.plan.id, via)} />;
      case "contact-entry":
        return (
          <button
            type="button"
            disabled={readOnly}
            onClick={() => setContactsOpen(true)}
            className="flex items-center gap-2 rounded-full px-3 py-2 text-[13px] font-semibold text-muted transition-colors hover:bg-group disabled:opacity-50"
          >
            <Users className="size-4" strokeWidth={1.75} aria-hidden="true" />
            {copy.contactEntry}
          </button>
        );
      case "start-card":
        return <StartCard variant={item.variant} friendName={item.friendName} onChanged={onChanged} readOnly={readOnly} />;
      case "hold-row":
        return <HoldRow planId={item.planId} role={role} title={item.title} action={item.detail} disabled={readOnly} />;
    }
  }

  return (
    <div className="relative flex h-full flex-col bg-screen">
      {framed ? <StatusBar time={formatStatusBarTime(snapshot.now)} /> : <div className="h-[env(safe-area-inset-top)] shrink-0" />}
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
                <MuseAvatar agent={view.agent} initial={initials[view.agent]} name={view.museName} size={44} />
              </button>
            ) : (
              <MuseAvatar agent={view.agent} initial={initials[view.agent]} name={view.museName} size={44} />
            )}
            <StatusPill name={view.museName} status={view.status} />
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
          </header>
          <div ref={scroller} className="quiet-scroll flex-1 overflow-y-auto px-4 pb-28 [mask-image:linear-gradient(to_bottom,transparent,black_14px)]">
            <div className="flex flex-col">
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
      {contactsOpen && role === "a" ? (
        <ContactSheet contacts={snapshot.contacts} museName={view.museName} onChanged={onChanged} onClose={() => setContactsOpen(false)} />
      ) : null}
      {sheetOpen && role === "b" ? (
        <AvatarSheet
          initial={initials.lisa}
          museName={view.museName}
          friendMuseName={view.friendMuseName}
          sharing={snapshot.sharing.lisa}
          onChanged={onChanged}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}
