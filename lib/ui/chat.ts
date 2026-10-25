import { copy } from "./copy";
import { googleCalendarUrl } from "./gcal";
import { daySeparatorFor, formatSpokenHour, formatWindowSpoken, listOf, namesFor } from "./format";
import { OTHER_SIGNALS, SHAWARMA_REEL, pastSignal, type PastSignal } from "@/lib/seed/past-signals";
import { paymentsForPlan, settleOffer, sideOfPayment, type SettleOffer } from "./payments";
import { tripThread, type GroupLine } from "./group";
import { capital } from "./tokens";
import { threadLines, type ThreadLine } from "./thread";
import type { AgentId, AvatarMood, Decision, MemberId, PlanState, Role, UiPayment, UiPlan, UiSnapshot, UiTrip } from "./types";

/*
 * What one phone's chat shows, derived from the snapshot. Pure, so it can be
 * tested without rendering. The agents' back-and-forth never appears here:
 * people get one bubble and one card per plan, and Activity holds the rest.
 */

export type ChatItem =
  | { kind: "separator"; id: string; day: string; time: string }
  | { kind: "bubble"; id: string; from: "muse" | "user"; text: string }
  | { kind: "thread-line"; id: string; line: ThreadLine }
  | { kind: "plan-card"; id: string; plan: UiPlan; role: Role; state: "live" | "sent" }
  | { kind: "reel-card"; id: string; poster: string; caption: string; place: string; image?: string; permalink?: string; live?: boolean; align: "left" | "right" }
  | { kind: "agreed-line"; id: string; names: string[]; count: number }
  | { kind: "member-card"; id: string; planId: string; member: MemberId; name: string }
  // A trip's group thread (lib/ui/group.ts): lines from people and their Muses, and the cards a person decides on.
  | { kind: "group-line"; id: string; line: GroupLine }
  | { kind: "trip-question"; id: string; planId: string; member: MemberId; forName: string | null; range: { low: number; high: number }; route: string }
  | { kind: "trip-budget"; id: string; trip: UiTrip }
  | { kind: "trip-itinerary"; id: string; trip: UiTrip }
  | { kind: "trip-open"; id: string; trip: UiTrip }
  | { kind: "trip-pot"; id: string; planId: string; trip: UiTrip; answerable: MemberId[]; viewer: MemberId; state: PlanState }
  | { kind: "payment-card"; id: string; payment: UiPayment; side: "payer" | "payee"; friendName: string; friendMuse: string }
  | { kind: "settle-card"; id: string; planId: string; offer: Extract<SettleOffer, { kind: "turn_on" | "ready" }>; friendName: string; friendMuse: string }
  | { kind: "outcome-replies"; id: string; planId: string }
  | { kind: "collapsed"; id: string; text: string }
  | { kind: "draft-card"; id: string; plan: UiPlan; draft: string }
  | { kind: "hold-row"; id: string; title: string; planId: string; googleUrl: string | null }
  | { kind: "start-card"; id: string; variant: "send-reel" | "simulated-friend" | "plan-trip"; friendName: string }
  | { kind: "contact-entry"; id: string };

/** A plan for three as one phone sees it: the people, in plan order, with what each has said so far. */
export type GroupView = {
  /** This phone's person got the reel and opened the plan; the other two answer to them. */
  coordinator: boolean;
  coordinatorName: string;
  /** Everyone in the plan, with this phone's person marked. */
  members: Array<{ id: MemberId; name: string; decision: Decision; you: boolean }>;
  /** The two other people. */
  others: Array<{ id: MemberId; name: string; muse: string; decision: Decision }>;
};

/** Which animated glyph a status line shows (public/status/status-<glyph>.svg). */
export type StatusGlyph = "reading" | "thinking" | "talking" | "waiting-you" | "waiting-friend" | "retrying" | "done";

export type PhoneStatus = { glyph: StatusGlyph; text: string };

export type PhoneView = {
  role: Role;
  agent: AgentId;
  friend: AgentId;
  museName: string;
  humanName: string;
  friendMuseName: string;
  friendHumanName: string;
  /** The status line under the avatar name: an animated glyph and lowercase words; null when the Muse is idle. */
  status: PhoneStatus | null;
  /** Set when the plan is for three: who is in, and what each has said. */
  group: GroupView | null;
  /** Which loop the header avatar plays: thinking while reading or while this Muse's own model call runs, talking while negotiating. */
  mood: AvatarMood;
  items: ChatItem[];
};

const roleAgent: Record<Role, AgentId> = { a: "aaron", b: "lisa" };
const agentRole: Record<AgentId, Role> = { aaron: "a", lisa: "b" };

export function viewForRole(snapshot: UiSnapshot, role: Role): PhoneView {
  const names = namesFor(snapshot);
  const agent = roleAgent[role];
  const friend = roleAgent[role === "a" ? "b" : "a"];
  // Michelle's own phone calls her Muse by its name, Mochi; the other phone still says "Michelle's Muse".
  const mine = { muse: role === "b" && snapshot.simulatedFriend ? snapshot.sides.lisa : names.muse[agent], human: names.human[agent] };
  const theirs = { muse: names.muse[friend], human: names.human[friend] };

  const items: ChatItem[] = [];
  // A refused follow-up is a dropped plan on the record, but on the phone nothing started: the person can try again.
  const plan = snapshot.plan && !snapshot.plan.refused ? snapshot.plan : null;
  // A plan for three has its own group thread (the trip's lines); only your private chat with your Muse joins it here.
  const thread = threadLines(snapshot, role).filter((line) => !snapshot.plan?.group || line.id.startsWith("thread-chat-"));
  const planGroup = plan?.group ?? null;
  const groupView: GroupView | null = planGroup
    ? {
        coordinator: planGroup.coordinator === agent,
        coordinatorName: names.human[planGroup.coordinator],
        members: planGroup.members.map(({ id, decision }) => ({ id, name: names.human[id], decision, you: id === agent })),
        others: planGroup.members.filter(({ id }) => id !== agent).map(({ id, decision }) => ({ id, name: names.human[id], muse: names.muse[id], decision })),
      }
    : null;
  // A trip is one group thread, people and Muses together, with its own cards (lib/ui/group.ts).
  if (plan?.kind === "trip" && plan.trip) {
    const thread = tripThread(snapshot, role);
    return { role, agent, friend, museName: mine.muse, humanName: mine.human, friendMuseName: theirs.muse, friendHumanName: theirs.human, status: thread.status, mood: thread.mood, group: groupView, items: thread.items };
  }
  // Who the plan is "with", as this phone says it: the friend in a pair, the other two in a plan for three.
  const withWhom = groupView ? listOf(groupView.others.map((other) => other.name)) : theirs.human;

  // The chat before Muse Friends: things the two shared and never turned into a plan, oldest first.
  const base = plan?.history[0]?.at ?? snapshot.now;
  for (const signal of [...OTHER_SIGNALS, demoReel(snapshot)]) pushPastSignal(items, signal, role, theirs.human, base);

  if (!plan) {
    // Before any plan: side b can send the reel; a judge on side a can bring in the simulated friend
    // (and tap again if the first start did not take).
    if (role === "b" && !snapshot.simulatedFriend) {
      items.push({ kind: "start-card", id: "start-reel", variant: "send-reel", friendName: theirs.muse });
    } else if (role === "a" && snapshot.simulatedFriend) {
      // Michelle is already the friend (the default on a phone): one tap has Sprout check with her.
      items.push({ kind: "start-card", id: "start-reel", variant: "send-reel", friendName: theirs.human });
      // The long-term scenario: the same Muses planning a trip months out. Offered beside the reel, never instead of it.
      items.push({ kind: "start-card", id: "start-trip", variant: "plan-trip", friendName: theirs.human });
    } else if (role === "a") {
      items.push({ kind: "start-card", id: "start-simulated", variant: "simulated-friend", friendName: theirs.muse });
    }
    if (role === "a" && snapshot.refusal) {
      // The person chose; the gate said no. Nothing was started, and the Muse says it plainly and neutrally.
      items.push({ kind: "bubble", id: "contact-chosen", from: "user", text: copy.contactChosen(snapshot.refusal.contactName) });
      items.push({ kind: "bubble", id: "contact-refused", from: "muse", text: copy.contactRefused(mine.muse) });
    }
    // Your own private conversation with your Muse needs no plan.
    for (const line of thread) items.push({ kind: "thread-line", id: line.id, line });
    if (role === "a") items.push({ kind: "contact-entry", id: "contact-entry" });
    return { role, agent, friend, museName: mine.muse, humanName: mine.human, friendMuseName: theirs.muse, friendHumanName: theirs.human, status: null, mood: "idle", group: null, items };
  }

  const today = daySeparatorFor(plan.history[0]?.at ?? snapshot.now, plan.history[0]?.at ?? snapshot.now);
  items.push({ kind: "separator", id: "sep-today", day: "Today", time: today.time });
  // The person's choice, in their own words, when the plan began with them naming someone.
  if (role === "a" && plan.target) items.push({ kind: "bubble", id: "contact-chosen", from: "user", text: copy.contactChosen(plan.target.name) });
  // Muse picks up the plan that died in the chat a week ago. A follow-up has no reel, so only a shared reel is picked up.
  if (!plan.target) {
    if (role === "b") {
      items.push({ kind: "bubble", id: "reel-sent", from: "user", text: copy.nudgeSent(theirs.human) });
      items.push({ kind: "bubble", id: "reel-sent-ack", from: "muse", text: SHAWARMA_REEL.nextIdeaMine(theirs.human) });
    } else {
      items.push({ kind: "bubble", id: "pickup", from: "muse", text: SHAWARMA_REEL.nextIdea(theirs.human) });
    }
  }
  // The Muses' turns that moved the plan, and each one's private word to its own person, land in the thread as they happen.
  for (const line of thread) if (line.phase !== "after") items.push({ kind: "thread-line", id: line.id, line });
  const planContextIds = new Set(plan.group?.contextIds ?? [plan.contextId]);
  const agreedCount = snapshot.messages.filter((message) => planContextIds.has(message.contextId)).length;
  const agreedLine: ChatItem = {
    kind: "agreed-line",
    id: "agreed-line",
    names: groupView ? groupView.members.map((member) => names.muse[member.id]) : [mine.muse, theirs.muse],
    count: agreedCount,
  };

  // The one bubble above the card: in a plan for three, the coordinator hears who is in and the others who is getting them together.
  const proposalText = (window: NonNullable<UiPlan["window"]>): string => {
    const when = formatWindowSpoken(window);
    if (!groupView) return copy.proposalBubble(theirs.human, plan.activityTitle, when);
    if (groupView.coordinator) return copy.groupProposalA(groupView.others[0].name, groupView.others[1].name, plan.activityTitle, when);
    const otherMember = groupView.others.find((other) => other.name !== groupView.coordinatorName)?.name ?? groupView.others[0].name;
    return copy.groupProposalB(capital(groupView.coordinatorName), otherMember, plan.activityTitle, when);
  };
  const pendingOthers = groupView ? groupView.others.filter((other) => other.decision === "pending") : [];

  const initiatorRole = agentRole[plan.initiator];
  let status: PhoneStatus | null = null;
  let mood: AvatarMood = "idle";
  const myDecision = plan.decisions[role];
  const theirDecision = plan.decisions[role === "a" ? "b" : "a"];

  switch (plan.state) {
    case "detected":
      // A follow-up has no reel to read: Sprout is reaching out to the person they named.
      status = role === "a" ? (plan.target ? { glyph: "talking", text: copy.statusReachingOut(theirs.human) } : { glyph: "reading", text: copy.statusReading(theirs.human) }) : null;
      if (role === "a") mood = "thinking";
      break;
    case "negotiating":
      status = { glyph: "talking", text: copy.statusTalking(groupView?.coordinator ? listOf(groupView.others.map((other) => other.muse)) : theirs.muse) };
      mood = "talking";
      break;
    case "awaiting_humans":
      if (plan.window) {
        items.push({ kind: "bubble", id: "proposal", from: "muse", text: proposalText(plan.window) });
      }
      if (myDecision === "accepted") {
        items.push({ kind: "collapsed", id: "decision-collapsed", text: copy.youSaidYes });
        status = {
          glyph: "waiting-friend",
          text: copy.statusWaitingFriend(groupView ? listOf((pendingOthers.length > 0 ? pendingOthers : groupView.others).map((other) => other.name)) : theirs.human),
        };
      } else {
        items.push({ kind: "plan-card", id: "plan-card", plan, role, state: "live" });
        status = { glyph: "waiting-you", text: copy.statusWaitingYou };
      }
      // Kai (Pebble's person) has no phone: the coordinator's phone carries Kai's card until they answer, and when one judge plays
      // alone a model answers it (the card says so).
      const phoneless = groupView?.coordinator ? pendingOthers.find((other) => other.id === "kai") : undefined;
      if (phoneless) items.push({ kind: "member-card", id: `member-card-${phoneless.id}`, planId: plan.id, member: phoneless.id, name: phoneless.name });
      if (agreedCount > 0) items.push(agreedLine);
      break;
    case "confirmed":
    case "scheduled":
    case "reminded":
    case "followed_up": {
      if (plan.window) {
        items.push({ kind: "bubble", id: "proposal", from: "muse", text: proposalText(plan.window) });
      }
      items.push({ kind: "collapsed", id: "decision-collapsed", text: copy.youSaidYes });
      if (agreedCount > 0) items.push(agreedLine);
      if (role === initiatorRole && plan.draft) {
        items.push({ kind: "bubble", id: "draft-intro", from: "muse", text: groupView ? copy.groupDraftIntro(withWhom) : copy.draftIntroA(theirs.human) });
        items.push({ kind: "draft-card", id: "draft-card", plan, draft: plan.draft });
      } else {
        items.push({ kind: "bubble", id: "draft-intro", from: "muse", text: copy.draftIntroB(theirs.human) });
      }
      if (plan.state !== "confirmed" && plan.window) {
        items.push({ kind: "bubble", id: "hold-bubble", from: "muse", text: copy.holdBubble(formatWindowSpoken(plan.window)) });
        items.push({
          kind: "hold-row",
          id: "hold-row",
          title: copy.holdTitle(plan.activityTitle, withWhom),
          planId: plan.id,
          googleUrl: googleCalendarUrl({
            title: copy.holdTitle(plan.activityTitle, withWhom),
            window: plan.window,
            details: groupView ? copy.groupHoldDetails(...(groupView.members.map((member) => names.muse[member.id]) as [string, string, string])) : copy.holdDetails(names.muse.aaron, names.muse.lisa),
            location: plan.place,
          }),
        });
      }
      if (plan.state === "reminded" || plan.state === "followed_up") {
        const reminded = plan.history.find((entry) => entry.state === "reminded");
        if (reminded) {
          const sep = daySeparatorFor(reminded.at, reminded.at);
          items.push({ kind: "separator", id: "sep-reminded", day: dayWordFor(reminded.at), time: sep.time });
          const startTime = plan.window ? formatSpokenHour(plan.window.start) : "the start";
          items.push({ kind: "bubble", id: "reminder", from: "muse", text: copy.reminder(plan.activityTitle, withWhom, startTime) });
        }
      }
      if (plan.state === "followed_up") {
        const followedUp = plan.history.find((entry) => entry.state === "followed_up");
        if (followedUp) {
          const sep = daySeparatorFor(followedUp.at, followedUp.at);
          items.push({ kind: "separator", id: "sep-followup", day: dayWordFor(followedUp.at), time: sep.time });
          items.push({ kind: "bubble", id: "followup", from: "muse", text: copy.followUp });
          pushOutcome(items, plan, role, theirs.human);
        }
      }
      break;
    }
    case "dropped": {
      if (snapshot.failure) {
        items.push({ kind: "bubble", id: "dropped", from: "muse", text: copy.failedPlan(names.muse[snapshot.failure.agent]) });
      } else if (myDecision === "declined") {
        items.push({ kind: "bubble", id: "dropped", from: "muse", text: copy.youPassed });
      } else if (groupView && groupView.others.some((other) => other.decision === "declined")) {
        const declined = groupView.others.filter((other) => other.decision === "declined").map((other) => other.name);
        items.push({ kind: "bubble", id: "dropped", from: "muse", text: copy.friendPassed(listOf(declined)) });
      } else if (!groupView && theirDecision === "declined") {
        items.push({ kind: "bubble", id: "dropped", from: "muse", text: copy.friendPassed(theirs.human) });
      } else {
        items.push({ kind: "bubble", id: "dropped", from: "muse", text: groupView ? copy.groupDropped : copy.dropped(theirs.human) });
      }
      break;
    }
    default:
      break;
  }

  // Money after a confirmed plan: each payment as a card, then, when it is on offer, the way to settle up.
  for (const payment of paymentsForPlan(snapshot, plan)) {
    items.push({ kind: "payment-card", id: `payment-${payment.id}`, payment, side: sideOfPayment(payment, agent), friendName: theirs.human, friendMuse: theirs.muse });
  }
  const offer = settleOffer(snapshot, plan, agent);
  if (offer.kind === "turn_on" || offer.kind === "ready") {
    items.push({ kind: "settle-card", id: "settle-card", planId: plan.id, offer, friendName: theirs.human, friendMuse: theirs.muse });
  }

  // What comes after the person decides: the friend's scripted answer, and the person's own private questions to their Muse.
  for (const line of thread) if (line.phase === "after") items.push({ kind: "thread-line", id: line.id, line });

  if (snapshot.inFlight?.agents.includes(agent)) mood = "thinking";
  // While negotiating, the glyph follows the header loop: thinking while this Muse's own call runs, talking while it waits.
  if (plan.state === "negotiating" && mood === "thinking") status = { glyph: "thinking", text: copy.statusThinking };
  // A confirmed plan says "sent" for a moment (StatusPill clears it after two seconds), then the name alone.
  if (plan.state === "confirmed" && status === null) status = { glyph: "done", text: copy.statusDone };
  if (snapshot.failure) {
    status = { glyph: "retrying", text: copy.statusTrouble(names.muse[snapshot.failure.agent]) };
    mood = "idle";
  }
  return { role, agent, friend, museName: mine.muse, humanName: mine.human, friendMuseName: theirs.muse, friendHumanName: theirs.human, status, mood, group: groupView, items };
}

/** Only a person's answer counts: "We went!" is the hangout that happened; "Didn't happen" counts nothing. */
function pushOutcome(items: ChatItem[], plan: UiPlan, role: Role, friend: string) {
  const outcome = plan.outcome;
  if (!outcome) {
    items.push({ kind: "outcome-replies", id: "outcome-replies", planId: plan.id });
    return;
  }
  if (outcome.result === "didnt") {
    items.push({ kind: "bubble", id: "outcome-answer", from: "user", text: copy.outcomeDidnt });
    items.push({ kind: "bubble", id: "outcome-reply", from: "muse", text: copy.outcomeDidntReply(plan.activityTitle) });
    return;
  }
  items.push({ kind: "bubble", id: "outcome-answer", from: "user", text: copy.outcomeWent });
  items.push({ kind: "bubble", id: "outcome-reply", from: "muse", text: copy.outcomeWentReply });
  // The next idea comes from what the two already shared, never a repeat of the same place.
  const next = (outcome.nextIdeaId ? pastSignal(outcome.nextIdeaId) : undefined) ?? mostRecent(OTHER_SIGNALS);
  if (next) items.push({ kind: "bubble", id: "next-idea", from: "muse", text: role === "a" ? next.nextIdea(friend) : next.nextIdeaMine(friend) });
  items.push({ kind: "collapsed", id: "closing", text: copy.closingLine });
}

function mostRecent(signals: PastSignal[]): PastSignal | undefined {
  return [...signals].sort((first, second) => first.daysAgo - second.daysAgo)[0];
}

/** The shawarma reel as shared in the chat: the owner's real reel when it was read live from Instagram. */
function demoReel(snapshot: UiSnapshot): PastSignal {
  const reel = snapshot.reel;
  if (!reel) return SHAWARMA_REEL;
  return {
    ...SHAWARMA_REEL,
    poster: reel.username,
    caption: reel.caption,
    title: copy.reelLivePlace,
    image: reel.thumbnailUrl ?? undefined,
    permalink: reel.permalink,
    live: true,
  };
}

/** One old share: a day separator, the share (a reel card for a reel), and the reply that went nowhere. */
function pushPastSignal(items: ChatItem[], signal: PastSignal, role: Role, friend: string, baseIso: string) {
  const at = new Date(new Date(baseIso).getTime() - signal.daysAgo * 24 * 60 * 60 * 1000);
  items.push({ kind: "separator", id: `sep-${signal.id}`, day: pastDayLabel(at, signal.daysAgo), time: signal.time });
  items.push({ kind: "bubble", id: `${signal.id}-line`, from: "muse", text: role === "a" ? signal.sentLine(friend) : signal.sentLineMine(friend) });
  if (signal.kind === "reel" && signal.poster && signal.caption) {
    items.push({
      kind: "reel-card",
      id: `${signal.id}-card`,
      poster: signal.poster,
      caption: signal.caption,
      place: signal.title,
      image: signal.image,
      permalink: signal.permalink,
      live: signal.live,
      align: role === "a" ? "left" : "right",
    });
  }
  items.push({ kind: "bubble", id: `${signal.id}-reply`, from: "user", text: signal.reply });
}

/** "Last Saturday" for a week ago; a short date ("Sep 21") for anything older. */
function pastDayLabel(at: Date, daysAgo: number): string {
  if (daysAgo <= 7) return `Last ${at.toLocaleDateString("en-US", { weekday: "long", timeZone: "America/Chicago" })}`;
  return at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
}

function dayWordFor(iso: string): string {
  return daySeparatorFor(iso, "2000-01-01T00:00:00Z").day;
}
