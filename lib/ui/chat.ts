import { copy } from "./copy";
import { daySeparatorFor, formatSpokenHour, formatWindowSpoken, namesFor } from "./format";
import type { AgentId, Role, UiPlan, UiSnapshot } from "./types";

/*
 * What one phone's chat shows, derived from the snapshot. Pure, so it can be
 * tested without rendering. The agents' back-and-forth never appears here:
 * people get one bubble and one card per plan, and Activity holds the rest.
 */

export type ChatItem =
  | { kind: "separator"; id: string; day: string; time: string }
  | { kind: "bubble"; id: string; from: "muse" | "user"; text: string }
  | { kind: "plan-card"; id: string; plan: UiPlan; role: Role; state: "live" | "sent" }
  | { kind: "collapsed"; id: string; text: string }
  | { kind: "draft-card"; id: string; plan: UiPlan; draft: string }
  | { kind: "hold-row"; id: string; title: string; detail: string; planId: string }
  | { kind: "start-card"; id: string; variant: "send-reel" | "simulated-friend"; friendName: string };

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
  const plan = snapshot.plan;

  items.push({ kind: "separator", id: "sep-old", day: "Sep 28", time: "6:14 PM" });
  if (role === "a") {
    items.push({ kind: "bubble", id: "old-1", from: "muse", text: `${theirs.human} sent you a reel from a shawarma place. 🎞️` });
    items.push({ kind: "bubble", id: "old-2", from: "user", text: "we should go!" });
  } else {
    items.push({ kind: "bubble", id: "old-1", from: "muse", text: `You sent ${theirs.human} a reel from a shawarma place. 🎞️` });
    items.push({ kind: "bubble", id: "old-2", from: "user", text: "we should go!" });
  }

  if (!plan) {
    // Before any plan: side b can send the reel; a judge on side a can bring in the simulated friend
    // (and tap again if the first start did not take).
    if (role === "b" && !snapshot.simulatedFriend) {
      items.push({ kind: "start-card", id: "start-reel", variant: "send-reel", friendName: theirs.muse });
    } else if (role === "a") {
      items.push({ kind: "start-card", id: "start-simulated", variant: "simulated-friend", friendName: theirs.muse });
    }
    return { role, agent, friend, museName: mine.muse, humanName: mine.human, friendMuseName: theirs.muse, friendHumanName: theirs.human, status: null, items };
  }

  const today = daySeparatorFor(plan.history[0]?.at ?? snapshot.now, plan.history[0]?.at ?? snapshot.now);
  items.push({ kind: "separator", id: "sep-today", day: "Today", time: today.time });
  if (role === "b") {
    items.push({ kind: "bubble", id: "reel-sent", from: "user", text: `Send this to ${theirs.human} 🎞️` });
    items.push({ kind: "bubble", id: "reel-sent-ack", from: "muse", text: `Sent it to ${theirs.human}.` });
  }

  const initiatorRole = agentRole[plan.initiator];
  let status: string | null = null;
  const myDecision = plan.decisions[role];
  const theirDecision = plan.decisions[role === "a" ? "b" : "a"];

  switch (plan.state) {
    case "detected":
      status = role === "a" ? copy.statusReading(theirs.human) : null;
      break;
    case "negotiating":
      status = copy.statusTalking(theirs.muse);
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
          detail: copy.holdAction,
          planId: plan.id,
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
          items.push({ kind: "bubble", id: "followup", from: "muse", text: copy.followUp(theirs.human) });
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

  if (snapshot.failure) status = copy.statusTrouble(names.muse[snapshot.failure.agent]);
  return { role, agent, friend, museName: mine.muse, humanName: mine.human, friendMuseName: theirs.muse, friendHumanName: theirs.human, status, items };
}

function dayWordFor(iso: string): string {
  return daySeparatorFor(iso, "2000-01-01T00:00:00Z").day;
}
