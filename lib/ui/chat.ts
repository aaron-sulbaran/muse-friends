import { copy } from "./copy";
import { googleCalendarUrl } from "./gcal";
import { daySeparatorFor, formatSpokenHour, formatWindowSpoken, namesFor } from "./format";
import { OTHER_SIGNALS, SHAWARMA_REEL, pastSignal, type PastSignal } from "@/lib/seed/past-signals";
import type { AgentId, AvatarMood, Role, UiPlan, UiSnapshot } from "./types";

/*
 * What one phone's chat shows, derived from the snapshot. Pure, so it can be
 * tested without rendering. The agents' back-and-forth never appears here:
 * people get one bubble and one card per plan, and Activity holds the rest.
 */

export type ChatItem =
  | { kind: "separator"; id: string; day: string; time: string }
  | { kind: "bubble"; id: string; from: "muse" | "user"; text: string }
  | { kind: "plan-card"; id: string; plan: UiPlan; role: Role; state: "live" | "sent" }
  | { kind: "reel-card"; id: string; poster: string; caption: string; place: string; image?: string; permalink?: string; live?: boolean; align: "left" | "right" }
  | { kind: "agreed-line"; id: string; first: string; second: string; count: number }
  | { kind: "outcome-replies"; id: string; planId: string }
  | { kind: "collapsed"; id: string; text: string }
  | { kind: "draft-card"; id: string; plan: UiPlan; draft: string }
  | { kind: "hold-row"; id: string; title: string; planId: string; googleUrl: string | null }
  | { kind: "start-card"; id: string; variant: "send-reel" | "simulated-friend"; friendName: string }
  | { kind: "contact-entry"; id: string };

export type PhoneView = {
  role: Role;
  agent: AgentId;
  friend: AgentId;
  museName: string;
  humanName: string;
  friendMuseName: string;
  friendHumanName: string;
  /** The status line under the avatar name, with its leading emoji; null when idle. */
  status: string | null;
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
  const mine = { muse: names.muse[agent], human: names.human[agent] };
  const theirs = { muse: names.muse[friend], human: names.human[friend] };

  const items: ChatItem[] = [];
  // A refused follow-up is a dropped plan on the record, but on the phone nothing started: the person can try again.
  const plan = snapshot.plan && !snapshot.plan.refused ? snapshot.plan : null;

  // The chat before Muse Friends: things the two shared and never turned into a plan, oldest first.
  const base = plan?.history[0]?.at ?? snapshot.now;
  for (const signal of [...OTHER_SIGNALS, demoReel(snapshot)]) pushPastSignal(items, signal, role, theirs.human, base);

  if (!plan) {
    // Before any plan: side b can send the reel; a judge on side a can bring in the simulated friend
    // (and tap again if the first start did not take).
    if (role === "b" && !snapshot.simulatedFriend) {
      items.push({ kind: "start-card", id: "start-reel", variant: "send-reel", friendName: theirs.muse });
    } else if (role === "a") {
      items.push({ kind: "start-card", id: "start-simulated", variant: "simulated-friend", friendName: theirs.muse });
    }
    if (role === "a" && snapshot.refusal) {
      // The person chose; the gate said no. Nothing was started, and the Muse says it plainly and neutrally.
      items.push({ kind: "bubble", id: "contact-chosen", from: "user", text: copy.contactChosen(snapshot.refusal.contactName) });
      items.push({ kind: "bubble", id: "contact-refused", from: "muse", text: copy.contactRefused(mine.muse) });
    }
    if (role === "a") items.push({ kind: "contact-entry", id: "contact-entry" });
    return { role, agent, friend, museName: mine.muse, humanName: mine.human, friendMuseName: theirs.muse, friendHumanName: theirs.human, status: null, mood: "idle", items };
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
  const agreedCount = snapshot.messages.filter((message) => message.contextId === plan.contextId).length;
  const agreedLine: ChatItem = { kind: "agreed-line", id: "agreed-line", first: mine.muse, second: theirs.muse, count: agreedCount };

  const initiatorRole = agentRole[plan.initiator];
  let status: string | null = null;
  let mood: AvatarMood = "idle";
  const myDecision = plan.decisions[role];
  const theirDecision = plan.decisions[role === "a" ? "b" : "a"];

  switch (plan.state) {
    case "detected":
      status = role === "a" ? (plan.target ? copy.statusReachingOut(theirs.human) : copy.statusReading(theirs.human)) : null;
      if (role === "a") mood = "thinking";
      break;
    case "negotiating":
      status = copy.statusTalking(theirs.muse);
      mood = "talking";
      break;
    case "awaiting_humans":
      if (plan.window) {
        items.push({
          kind: "bubble",
          id: "proposal",
          from: "muse",
          text: copy.proposalBubble(theirs.human, plan.activityTitle, formatWindowSpoken(plan.window)),
        });
      }
      if (myDecision === "accepted") {
        items.push({ kind: "collapsed", id: "decision-collapsed", text: copy.youSaidYes });
        status = copy.statusWaitingFriend(theirs.human);
      } else {
        items.push({ kind: "plan-card", id: "plan-card", plan, role, state: "live" });
        status = copy.statusWaitingYou;
      }
      if (agreedCount > 0) items.push(agreedLine);
      break;
    case "confirmed":
    case "scheduled":
    case "reminded":
    case "followed_up": {
      if (plan.window) {
        items.push({
          kind: "bubble",
          id: "proposal",
          from: "muse",
          text: copy.proposalBubble(theirs.human, plan.activityTitle, formatWindowSpoken(plan.window)),
        });
      }
      items.push({ kind: "collapsed", id: "decision-collapsed", text: copy.youSaidYes });
      if (agreedCount > 0) items.push(agreedLine);
      if (role === initiatorRole && plan.draft) {
        items.push({ kind: "bubble", id: "draft-intro", from: "muse", text: copy.draftIntroA(theirs.human) });
        items.push({ kind: "draft-card", id: "draft-card", plan, draft: plan.draft });
      } else {
        items.push({ kind: "bubble", id: "draft-intro", from: "muse", text: copy.draftIntroB(theirs.human) });
      }
      if (plan.state !== "confirmed" && plan.window) {
        items.push({ kind: "bubble", id: "hold-bubble", from: "muse", text: copy.holdBubble(formatWindowSpoken(plan.window)) });
        items.push({
          kind: "hold-row",
          id: "hold-row",
          title: copy.holdTitle(plan.activityTitle, theirs.human),
          planId: plan.id,
          googleUrl: googleCalendarUrl({
            title: copy.holdTitle(plan.activityTitle, theirs.human),
            window: plan.window,
            details: copy.holdDetails(names.muse.aaron, names.muse.lisa),
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
          items.push({ kind: "bubble", id: "reminder", from: "muse", text: copy.reminder(plan.activityTitle, theirs.human, startTime) });
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
      } else if (theirDecision === "declined") {
        items.push({ kind: "bubble", id: "dropped", from: "muse", text: copy.friendPassed(theirs.human) });
      } else {
        items.push({ kind: "bubble", id: "dropped", from: "muse", text: copy.dropped(theirs.human) });
      }
      break;
    }
    default:
      break;
  }

  if (snapshot.inFlight?.agent === agent) mood = "thinking";
  if (snapshot.failure) {
    status = copy.statusTrouble(names.muse[snapshot.failure.agent]);
    mood = "idle";
  }
  return { role, agent, friend, museName: mine.muse, humanName: mine.human, friendMuseName: theirs.muse, friendHumanName: theirs.human, status, mood, items };
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
