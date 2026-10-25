"use client";

import { BatteryFull, Shield, Signal, Users, Wallet, Wifi } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { onboardingItems, viewForRole, type ChatItem } from "@/lib/ui/chat";
import { ARRIVAL_AT_MS, ARRIVAL_LINGER_MS, withReelArrival, type ArrivalStage } from "@/lib/ui/arrival";
import { copy } from "@/lib/ui/copy";
import { discInitials, formatStatusBarTime, listOf, namesFor } from "@/lib/ui/format";
import { postChat, postDecision, postHandoff, postPrivacy, postReplan, postSignal, postSimulatedFriendSwitch, type Result } from "@/lib/ui/actions";
import type { GoalContext } from "@/lib/ui/goals";
import { runInProgress } from "@/lib/ui/entry";
import { friendsIndicator, pickerMode, ROOM_FRIEND, roomFriendTier, shareFriend, startRequest, startsRunAtDone } from "@/lib/ui/onboarding-flow";
import { getRoom } from "@/lib/ui/room";
import { endsRun, lineOfBubble, startsRun, voicesOf, type Sender, type ThreadLine } from "@/lib/ui/thread";
import { useFriendReplied } from "@/lib/ui/use-friend-reply";
import { useOnboarding } from "@/lib/ui/use-onboarding";
import type { Role, UiPayment, UiSnapshot } from "@/lib/ui/types";
import { DaySeparator, TypingDots } from "./ChatBubble";
import { AgreedLine } from "./AgreedLine";
import { AvatarSheet } from "./AvatarSheet";
import { Composer } from "./Composer";
import { ContactSheet } from "./ContactSheet";
import { FriendPickerSheet } from "./FriendPickerSheet";
import { FriendsOptInCard } from "./FriendsOptInCard";
import { OptOutCard, TurnOnFriendsPill } from "./OptOutCard";
import { ShareSheet } from "./ShareSheet";
import { CheckMark } from "./CheckMark";
import { DraftCard } from "./DraftCard";
import { GoalDetail, GoalsTab } from "./GoalsTab";
import { HoldRow } from "./HoldRow";
import { GroupAvatars, GroupItem, isGroupItem } from "./GroupThread";
import { tripOwners, tripWithNames } from "@/lib/ui/group";
import { MemberCard } from "./MemberCard";
import { MuseAvatar } from "./MuseAvatar";
import { PaymentCard } from "./PaymentCard";
import { OutcomeReplies } from "./OutcomeReplies";
import { SimulatedFriendBanner } from "./SimulatedFriendBanner";
import { SenderChip, SenderPicture } from "./SenderChip";
import { ReelCard } from "./ReelCard";
import { RecommendationCard } from "./RecommendationCard";
import { SettleCard } from "./SettleCard";
import { ReplayBadge } from "./ReplayBadge";
import { StartCard } from "./StartCard";
import { StatusPill } from "./StatusPill";
import { ThreadBubble } from "./ThreadBubble";
import { TabBar, type Tab } from "./TabBar";
import { WalletChip } from "./WalletChip";

// The Invite sheet carries a QR encoder, so it loads only when someone opens it.
const InviteSheet = dynamic(() => import("./InviteSheet").then((module) => module.InviteSheet), { ssr: false });

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
  /** A judge's own phone, side a: the chat opens with the onboarding (D26) until it is done. The stage and tests leave it off. */
  onboarding?: boolean;
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

const cardKinds: ReadonlySet<ChatItem["kind"]> = new Set(["plan-card", "draft-card", "start-card", "trip-question", "trip-budget", "trip-itinerary", "trip-open", "trip-pot", "onboarding-friends", "onboarding-optout"]);

/** 4px between bubbles of one run, 14px between runs, 16px around a card. */
function spacingBefore(previous: ChatItem | undefined, item: ChatItem, lineOf: (item: ChatItem | undefined) => ThreadLine | undefined): string {
  if (!previous) return "";
  if (cardKinds.has(previous.kind) || cardKinds.has(item.kind)) return "mt-4";
  // A trip's thread: a run of one speaker sits close, a new speaker sits apart.
  if (previous.kind === "group-line" && item.kind === "group-line") return item.line.first ? "mt-3.5" : "mt-1.5";
  const line = lineOf(item);
  return line && !startsRun(lineOf(previous), line) ? "mt-1" : "mt-3.5";
}

/** One Muse phone's screen: avatar and status on top, the chat, and the tab bar. */
export function MuseScreen({ snapshot, role, framed, onChanged, readOnly = false, onPaused, onOpenPayment, standalone, onboarding = false }: Props) {
  const friendReplied = useFriendReplied(snapshot.plan);
  const view = viewForRole(snapshot, role, { friendReplied });
  const [pending, setPending] = useState(false);
  const [replanError, setReplanError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [contactsOpen, setContactsOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");
  const [goalOpen, setGoalOpen] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const chatContent = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const thinking = snapshot.inFlight?.agent === view.agent;
  // A trip is one group thread: the header shows the three Muses and the group's name, and the wallet chip (the two seats' own wallets) steps aside.
  const tripPlan = snapshot.plan?.kind === "trip" ? snapshot.plan.trip : null;
  const initials = discInitials(snapshot);
  const avatar = tripPlan ? (
    <GroupAvatars trip={tripPlan} mood={view.mood} viewer={view.agent} />
  ) : (
    <MuseAvatar agent={view.agent} initial={initials[view.agent]} name={view.museName} size={56} mood={view.mood} />
  );
  const simulated = snapshot.simulatedFriend;
  const names = namesFor(snapshot);
  // Bubbles and the Muses' own lines read as one thread: who is speaking is a sender, and a run shows its chip once.
  const voices = voicesOf(view);
  const lineOf = (item: ChatItem | undefined): ThreadLine | undefined =>
    item?.kind === "thread-line" ? item.line : item?.kind === "bubble" ? lineOfBubble(item, voices) : undefined;
  const friendSender: Sender = { kind: "friend", name: view.friendHumanName, simulated };
  // Onboarding (D26): a judge's own phone opens with Sprout's greeting, a name, and the choice of Friends. Until it is done
  // it is the whole chat, with no tab bar and no composer; after an opt-out the chat is still there, but nothing starts.
  const [onboardingState, dispatchOnboarding] = useOnboarding(getRoom());
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const onboardingOn = onboarding && role === "a" && !readOnly;
  const onboardingActive = onboardingOn && onboardingState.step !== "done";
  const friendsOff = onboardingOn && onboardingState.step === "done" && !onboardingState.friendsOn;
  // After Done, Michelle's reel arrives as a new message and the run starts a beat later (see lib/ui/arrival.ts). Null is the
  // static chat: a reload, the stage, or a phone that never ran onboarding in this tab.
  const [arrival, setArrival] = useState<ArrivalStage | null>(null);
  const arrivalTimers = useRef<number[]>([]);
  const livePlan = useRef(snapshot.plan);
  useEffect(() => {
    livePlan.current = snapshot.plan;
  }, [snapshot.plan]);
  useEffect(() => {
    const timers = arrivalTimers.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);
  const shownItems: ChatItem[] = onboardingOn
    ? [...onboardingItems(onboardingState, view.friendHumanName), ...(onboardingActive ? [] : friendsOff ? view.items.filter((item) => item.kind !== "start-card" && item.kind !== "contact-entry") : view.items)]
    : view.items;
  const chatItems = withReelArrival(shownItems, arrival, snapshot.plan !== null);
  const composerOn = role === "a" && !readOnly && !onboardingActive;
  const goalContext: GoalContext = {
    friend: view.group ? listOf(view.group.others.map((other) => other.name)) : view.friendHumanName,
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
  }, [chatItems.length, thinking, tab]);

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

  async function replan(planId: string, followUpTarget?: string) {
    if (readOnly) return;
    setPending(true);
    setReplanError(null);
    const result = await postReplan(planId, role, followUpTarget);
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

  function reportOnboarding(result: Result) {
    if (!result.ok) {
      if (result.paused) onPaused?.(result.message);
      else setOnboardingError(result.message);
    }
    onChanged();
    return result.ok;
  }

  /**
   * Continue on the who step: the judge's tier for the room's friend is written for their own Muse, with Michelle on
   * first (switching her on resets the room, so it never follows the tier). Nothing runs yet: the run starts at Done,
   * with the reel's arrival. Nobody who can take part above Off is the opt-out, and nothing will start.
   */
  async function continueFromWho() {
    const request = startRequest(onboardingState);
    dispatchOnboarding({ type: "continue" });
    if (!request) return;
    setOnboardingError(null);
    if (!snapshot.simulatedFriend && !reportOnboarding(await postSimulatedFriendSwitch(true))) return;
    reportOnboarding(await postPrivacy({ tier: request.tier }, "a"));
  }

  /**
   * Done on the share step: the reel arrives (the card, then the judge's own "we should go!") and the run starts a beat
   * after, so the Muses' exchange happens in view. A run already going is left alone, and a failed start puts the
   * start card back with the error under it. Every timer is cleared if the screen goes away.
   */
  function finishOnboarding() {
    const starts = startsRunAtDone(onboardingState);
    dispatchOnboarding({ type: "done" });
    if (!starts) return;
    const timers = arrivalTimers.current;
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.length = 0;
    setArrival(0);
    const at = (stage: Exclude<ArrivalStage, 0>, run: () => void) => window.setTimeout(run, ARRIVAL_AT_MS[stage]);
    timers.push(
      at(1, () => setArrival(1)),
      at(2, () => setArrival(2)),
      at(3, async () => {
        if (runInProgress(livePlan.current)) return setArrival(null);
        setArrival(3);
        const started = reportOnboarding(await postSignal());
        if (!started) setArrival(null);
        else timers.push(window.setTimeout(() => setArrival(null), ARRIVAL_LINGER_MS));
      }),
    );
  }

  function renderItem(item: ChatItem) {
    if (isGroupItem(item)) return <GroupItem item={item} readOnly={readOnly} onChanged={onChanged} />;
    switch (item.kind) {
      case "separator":
        return <DaySeparator day={item.day} time={item.time} />;
      case "onboarding-friends":
        return <FriendsOptInCard state={onboardingState} dispatch={dispatchOnboarding} />;
      case "onboarding-optout":
        return <OptOutCard />;
      case "onboarding-turn-on":
        return <TurnOnFriendsPill onTurnOn={() => dispatchOnboarding({ type: "friendsOn" })} />;
      case "bubble":
      case "thread-line":
        return null; // drawn as a thread bubble in the list below, where its neighbors are known
      case "collapsed":
        return (
          <p className={`animate-fade-in text-[13px] leading-[18px] text-muted ${item.check ? "flex items-center gap-1.5" : ""}`} style={{ paddingLeft: 4 }}>
            {item.check ? <CheckMark className="size-4" /> : null}
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
            onReplan={() => replan(item.plan.id, item.plan.target?.id)}
            error={replanError}
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
        return <StartCard variant={item.variant} friendName={item.friendName} onChanged={onChanged} readOnly={readOnly} onPaused={onPaused} />;
      case "reel-card": {
        const card = <ReelCard image={item.image} poster={item.poster} posterImage={item.posterImage} caption={item.caption} place={item.place} permalink={item.permalink} align={item.align} label={item.live ? copy.reelLiveLabel : copy.reelLabel} />;
        if (item.align !== "left") return card;
        // The friend's reel is her message: her chip above it, her picture beside it, in the bubbles' column.
        return (
          <div>
            <SenderChip sender={friendSender} />
            <div className="flex items-end gap-2">
              <div className="w-6 shrink-0">
                <SenderPicture sender={friendSender} />
              </div>
              <div className="min-w-0 flex-1">{card}</div>
            </div>
          </div>
        );
      }
      case "agreed-line":
        // On the stage, Activity already sits between the phones; a phone on its own opens it as a sheet.
        return standalone ? <AgreedLine names={item.names} count={item.count} onOpen={() => setActivityOpen(true)} /> : null;
      case "member-card":
        return <MemberCard planId={item.planId} member={item.member} name={item.name} />;
      case "outcome-replies":
        return <OutcomeReplies planId={item.planId} role={role} onChanged={onChanged} readOnly={readOnly} />;
      case "hold-row":
        return <HoldRow planId={item.planId} role={role} title={item.title} when={item.when} googleUrl={item.googleUrl} disabled={readOnly} />;
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
            museName={item.museName}
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
      {simulated && role === "b" ? <SimulatedFriendBanner model={snapshot.simulatedFriendModel} /> : null}
      {tab === "chat" ? (
        <>
          <header className="relative flex shrink-0 flex-col items-center pb-3 pt-2">
            {role === "b" && !readOnly ? (
              <button
                type="button"
                onClick={() => setSheetOpen(true)}
                aria-label={`Open ${view.museName} settings`}
                className="rounded-full transition-transform hover:scale-105"
              >
                {avatar}
              </button>
            ) : standalone && !readOnly ? (
              // Muse opens Activity from the avatar; Sprout's phone has no settings sheet to compete with.
              <button
                type="button"
                onClick={() => setActivityOpen(true)}
                aria-label={copy.activityOpen}
                className="rounded-full transition-transform hover:scale-105"
              >
                {avatar}
              </button>
            ) : (
              avatar
            )}
            <StatusPill name={tripPlan ? tripPlan.title : view.museName} status={view.status} />
            {tripPlan ? <p className="mt-1.5 px-6 text-center text-[12px] leading-4 text-muted">{tripOwners(tripWithNames(snapshot, tripPlan), view.agent)}</p> : <WalletChip snapshot={snapshot} agent={view.agent} />}
            {onboardingOn && friendsIndicator(onboardingState) ? (
              <p className="mt-0.5 text-[11px] font-semibold leading-4 text-muted">{friendsIndicator(onboardingState)}</p>
            ) : null}
            {standalone && snapshot.mode === "replay" ? (
              <div className="absolute left-4 top-2">
                <ReplayBadge mode="replay" compact recording={snapshot.recording} />
              </div>
            ) : null}
            {role === "a" && !readOnly && !onboardingActive && (paymentsOnA || standalone) ? (
              <div className="absolute right-4 top-2 flex items-center gap-2">
                {paymentsOnA ? (
                  <button
                    type="button"
                    onClick={() => setSheetOpen(true)}
                    aria-label={`${view.museName} payments`}
                    className="grid size-8 place-items-center rounded-full bg-group transition-colors hover:bg-bubble-muse"
                  >
                    <Wallet className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
                  </button>
                ) : null}
                {standalone ? (
                  <button
                    type="button"
                    onClick={() => setInviteOpen(true)}
                    className="inline-flex h-8 items-center rounded-full bg-group px-3 text-[13px] font-semibold transition-colors hover:bg-bubble-muse"
                  >
                    {copy.invitePill}
                  </button>
                ) : null}
              </div>
            ) : null}
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
          <div
            ref={scroller}
            onScroll={(event) => {
              const element = event.currentTarget;
              nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
            }}
            className={`quiet-scroll flex-1 overflow-y-auto px-4 [mask-image:linear-gradient(to_bottom,transparent,black_14px)] ${composerOn ? "pb-3" : "pb-20"}`}>
            {/* Anchored to the bottom like any messaging app: a short chat sits just above the tab bar, empty space at the top. */}
            <div ref={chatContent} className="flex min-h-full flex-col justify-end">
              {chatItems.map((item, index) => {
                const previous = chatItems[index - 1];
                const line = lineOf(item);
                return (
                  <div key={item.id} className={spacingBefore(previous, item, lineOf)}>
                    {line ? (
                      <ThreadBubble line={line} showSender={startsRun(lineOf(previous), line)} showPicture={endsRun(line, lineOf(chatItems[index + 1]))} />
                    ) : (
                      renderItem(item)
                    )}
                  </div>
                );
              })}
              {thinking ? (
                <div className="mt-3.5">
                  <TypingDots />
                </div>
              ) : null}
              {onboardingError ? (
                <p role="alert" className="mt-3 text-[13px] leading-[18px] text-withheld">
                  {onboardingError}
                </p>
              ) : null}
            </div>
          </div>
          {composerOn ? (
            // Above the floating tab bar, below the cards: the demo never needs it, and it never covers them.
            <div className="mb-[72px]">
              <Composer
                museName={view.museName}
                onSend={async (text) => {
                  const result = await postChat(text);
                  onChanged();
                  return result;
                }}
              />
            </div>
          ) : null}
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
      {onboardingActive ? null : (
        <TabBar
          tab={tab}
          onSelect={(next) => {
            setTab(next);
            setGoalOpen(false);
          }}
        />
      )}
      {onboardingOn && pickerMode(onboardingState) ? (
        <FriendPickerSheet
          mode={pickerMode(onboardingState) ?? "choose"}
          state={onboardingState}
          dispatch={(action) => (action.type === "continue" ? void continueFromWho() : dispatchOnboarding(action))}
          onClose={() => dispatchOnboarding({ type: "notNow" })}
        />
      ) : null}
      {onboardingOn && shareFriend(onboardingState) ? (
        <ShareSheet
          friend={ROOM_FRIEND}
          tier={roomFriendTier(onboardingState)}
          sharing={snapshot.sharing.aaron}
          onChange={async (change) => {
            await postPrivacy(change, "a");
            onChanged();
          }}
          onBack={() => dispatchOnboarding({ type: "back" })}
          onDone={finishOnboarding}
        />
      ) : null}
      {contactsOpen && role === "a" && !onboardingActive ? (
        <ContactSheet contacts={snapshot.contacts} museName={view.museName} onChanged={onChanged} onPaused={onPaused} onClose={() => setContactsOpen(false)} />
      ) : null}
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
      {inviteOpen && role === "a" ? (
        <InviteSheet plan={snapshot.plan} simulatedFriend={simulated} onChanged={onChanged} onClose={() => setInviteOpen(false)} />
      ) : null}
      {sheetOpen && (role === "b" || paymentsOnA) ? (
        <AvatarSheet
          initial={initials.lisa}
          role={role}
          museName={view.museName}
          friendMuseName={view.friendMuseName}
          sharing={role === "b" ? snapshot.sharing.lisa : undefined}
          payments={snapshot.sandbox.enabled ? snapshot.paymentsScope[view.agent] : undefined}
          onOpenActivity={
            standalone
              ? () => {
                  setSheetOpen(false);
                  setActivityOpen(true);
                }
              : undefined
          }
          onChanged={onChanged}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </div>
  );
}
