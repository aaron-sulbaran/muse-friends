import { copy } from "./copy";
import { messageTitle, namesFor, policyStampFor } from "./format";
import type { AgentId, MemberId, MessageType, Role, UiPlan, UiSnapshot } from "./types";

/*
 * The phone thread as people read it (D32): the person and their friend still talking, with both Muses in the same
 * place and each one said to belong to someone. A Muse lands one plain line for each turn that changed the plan; the
 * raw wire (every message, tool call, redaction, refusal) stays in Activity. Pure, so it can be tested without rendering.
 */

export type Sender = {
  kind: "you" | "friend" | "your-muse" | "friend-muse";
  /** What the line is signed with: a person's first name, or a Muse's own name (Sprout, Mochi). */
  name: string;
  /** For a Muse, the person it belongs to. */
  owner?: string;
  /** True for a friend who is played by a model, until a real one joins. */
  simulated?: boolean;
  /** Which Muse, so the chip can draw it. Absent for people. A plan for three adds Pebble. */
  agent?: MemberId;
};

export type ThreadLine = {
  id: string;
  sender: Sender;
  text: string;
  /** A Muse's private word to its own person: shown in the thread, marked, and never on the friend's phone. */
  onlyYou?: boolean;
  /** For your own private question: the Muse it went to, named above the bubble. */
  to?: string;
  at?: string;
  /**
   * Where in the chat it belongs: "talk" with the Muses' turns before the offer, "after" once the person has decided, and
   * "reply" for the friend's answer to the message the person sent her, which sits right after the draft and its handoff.
   */
  phase?: "talk" | "after" | "reply";
};

/** The wait between the person's handoff and the simulated friend's answer, so it reads as a reply and not an echo. */
export const FRIEND_REPLY_DELAY_MS = 6000;

export type ThreadOptions = {
  /** False while the friend's answer to the handoff is still being "typed": the line is left out until the phone's own timer says so. */
  friendReplied?: boolean;
  /** False once the plan is agreed and the phone's hold is over: the Muses' exchange folds into the "agreed in n messages" line. */
  exchangeOpen?: boolean;
};

/** When the person handed the message off (the plan was scheduled): the moment the friend's answer is a reply to. */
export function handoffAt(plan: Pick<UiPlan, "history"> | null | undefined): string | undefined {
  return plan?.history.find((entry) => entry.state === "scheduled")?.at;
}

const roleAgent: Record<Role, AgentId> = { a: "aaron", b: "lisa" };

/** The turns the thread shows as they land: the opening intent (the offer), then each propose, counter, accept and decline. */
const PLAN_CHANGING: ReadonlySet<MessageType> = new Set(["intent", "propose", "counter", "accept", "decline"]);

/** A friend who is played by a model says one thing, once she has decided; a real friend's lines are their own. */
const decisionLine = { accepted: copy.threadFriendYes, declined: copy.threadFriendNo } as const;

export function threadLines(snapshot: UiSnapshot, role: Role, options: ThreadOptions = {}): ThreadLine[] {
  const plan = snapshot.plan;
  const names = namesFor(snapshot);
  const me = roleAgent[role];
  const muse = (agent: MemberId): Sender => ({ kind: agent === me ? "your-muse" : "friend-muse", name: snapshot.sides[agent], owner: names.human[agent], agent });

  const lines: ThreadLine[] = [];
  // The Muses' turns belong to a plan; the person's own private conversation with their Muse does not need one.
  if (plan) {
    for (const message of snapshot.messages) {
      // A message from another plan's thread, or one the inbox refused, is not part of this conversation.
      if (message.contextId !== plan.contextId || message.blockedRule !== undefined) continue;
      const sender = muse(message.from);
      if (PLAN_CHANGING.has(message.type)) lines.push({ id: `thread-${message.id}`, sender, text: messageTitle(message), at: message.at, phase: "talk" });
      const { withheld } = policyStampFor(message);
      if (message.from === me && withheld) {
        lines.push({ id: `thread-${message.id}-aside`, sender, text: copy.threadKeptOut(withheld, names.muse[message.to]), onlyYou: true, at: message.at, phase: "talk" });
      }
    }
  }

  // The simulated friend always sits in the second seat. Her yes is a reply to the message the person just sent her, so it
  // comes only after the handoff, a few seconds on (the phone's timer lifts `friendReplied`); her no is where the plan dropped.
  const decision = plan?.decisions.b ?? "pending";
  if (snapshot.simulatedFriend && decision !== "pending") {
    const sender: Sender = { kind: role === "a" ? "friend" : "you", name: names.human.lisa, simulated: true };
    if (decision === "accepted") {
      const handoff = handoffAt(plan);
      if (handoff && options.friendReplied !== false) {
        lines.push({ id: "thread-friend-accepted", sender, text: decisionLine.accepted, at: new Date(Date.parse(handoff) + FRIEND_REPLY_DELAY_MS).toISOString(), phase: "reply" });
      }
    } else {
      const settled = plan?.history.find((entry) => entry.state === "dropped")?.at;
      lines.push({ id: "thread-friend-declined", sender, text: decisionLine.declined, at: settled ?? lines.at(-1)?.at, phase: "after" });
    }
  }

  // Your own private conversation with your Muse (D31): your question, and its answer as an aside. Only side a has one.
  // Each line sits where it happened, before or after the friend's answer, not in a block at the end.
  if (role === "a") {
    for (const entry of snapshot.chat) {
      const sender: Sender = entry.from === "user" ? { kind: "you", name: names.human[me] } : muse(me);
      lines.push({ id: `thread-chat-${entry.id}`, sender, text: entry.text, onlyYou: true, ...(entry.from === "user" ? { to: snapshot.sides[me] } : {}), at: entry.at, phase: "after" });
    }
    lines.sort((first, second) => Date.parse(first.at ?? "") - Date.parse(second.at ?? ""));
  }
  return lines;
}

/**
 * The Muse whose model call is running right now, as this phone's reader sees it ("Sprout, your Muse", "Mochi, Michelle's
 * Muse"), or null when nobody is thinking or the plan is not a plain pair. It is the typing bubble's sender.
 */
export function typingSender(snapshot: UiSnapshot, role: Role): Sender | null {
  const flight = snapshot.inFlight;
  if (!flight || snapshot.plan?.group || (flight.agent !== "aaron" && flight.agent !== "lisa")) return null;
  const me = roleAgent[role];
  const names = namesFor(snapshot);
  return { kind: flight.agent === me ? "your-muse" : "friend-muse", name: snapshot.sides[flight.agent], owner: names.human[flight.agent], agent: flight.agent };
}

/** True when a line opens a run: a different sender than the line before it, so the chip shows above this bubble only. */
export function startsRun(previous: ThreadLine | undefined, line: ThreadLine): boolean {
  return !previous || previous.sender.kind !== line.sender.kind || previous.sender.name !== line.sender.name || previous.sender.owner !== line.sender.owner;
}

/** True when a line closes a run: the next line is a different sender, or there is none. The picture sits beside it. */
export function endsRun(line: ThreadLine, next: ThreadLine | undefined): boolean {
  return !next || startsRun(line, next);
}

/** The two voices of one phone's own chat: the person, and the Muse that is theirs. */
export function voicesOf(view: { agent: AgentId; museName: string; humanName: string }): { you: Sender; muse: Sender } {
  return {
    you: { kind: "you", name: view.humanName },
    muse: { kind: "your-muse", name: view.museName, owner: view.humanName, agent: view.agent },
  };
}

/** A chat bubble (the Muse's scripted lines to its person, or the person's own taps) as a line of the thread. */
export function lineOfBubble(item: { id: string; from: "muse" | "user"; text: string }, voices: ReturnType<typeof voicesOf>): ThreadLine {
  return { id: item.id, sender: item.from === "user" ? voices.you : voices.muse, text: item.text };
}
