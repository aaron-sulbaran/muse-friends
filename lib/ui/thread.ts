import { copy } from "./copy";
import { messageTitle, namesFor, policyStampFor } from "./format";
import type { AgentId, MessageType, Role, UiSnapshot } from "./types";

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
  /** Which Muse, so the chip can draw it. Absent for people. */
  agent?: AgentId;
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
  /** Where in the chat it belongs: "talk" with the Muses' turns before the offer, "after" once the person has decided. */
  phase?: "talk" | "after";
};

const roleAgent: Record<Role, AgentId> = { a: "aaron", b: "lisa" };

/** The turns that move a plan: an intent only opens the thread, and the reel and Sprout's read already say so. */
const PLAN_CHANGING: ReadonlySet<MessageType> = new Set(["propose", "counter", "accept", "decline"]);

/** A friend who is played by a model says one thing, once she has decided; a real friend's lines are their own. */
const decisionLine = { accepted: copy.threadFriendYes, declined: copy.threadFriendNo } as const;

export function threadLines(snapshot: UiSnapshot, role: Role): ThreadLine[] {
  const plan = snapshot.plan;
  if (!plan) return [];
  const names = namesFor(snapshot);
  const me = roleAgent[role];
  const muse = (agent: AgentId): Sender => ({ kind: agent === me ? "your-muse" : "friend-muse", name: snapshot.sides[agent], owner: names.human[agent], agent });

  const lines: ThreadLine[] = [];
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

  // Your own private conversation with your Muse (D31): your question, and its answer as an aside. Only side a has one.
  if (role === "a") {
    for (const entry of snapshot.chat) {
      const sender: Sender = entry.from === "user" ? { kind: "you", name: names.human[me] } : muse(me);
      lines.push({ id: `thread-chat-${entry.id}`, sender, text: entry.text, onlyYou: true, ...(entry.from === "user" ? { to: snapshot.sides[me] } : {}), at: entry.at, phase: "after" });
    }
    lines.sort((first, second) => Date.parse(first.at ?? "") - Date.parse(second.at ?? ""));
  }

  // The simulated friend always sits in the second seat.
  const decision = plan.decisions.b;
  if (snapshot.simulatedFriend && decision !== "pending") {
    const sender: Sender = { kind: role === "a" ? "friend" : "you", name: names.human.lisa, simulated: true };
    lines.push({ id: `thread-friend-${decision}`, sender, text: decisionLine[decision], at: lines.at(-1)?.at, phase: "after" });
  }
  return lines;
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
