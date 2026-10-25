import type { ChatItem, PhoneStatus } from "./chat";
import { listOf, namesFor } from "./format";
import type { Sender, ThreadLine } from "./thread";
import { capital } from "./tokens";
import type { AvatarMood, MemberId, Role, UiSnapshot, UiTrip, UiTripAnswer, UiTripPerson } from "./types";

/*
 * The group thread of a trip as one phone shows it (D32, kb/design/thread.md and kb/design/group/): people and their
 * Muses in the same chat, every Muse line owned by a person, every simulated person tagged, and the decisions (the
 * bounded question, the budget, the plan, the pot) as cards. Pure, so it can be tested without rendering. Client-safe:
 * the model-played people live in ./group-players.ts, which is server-only.
 *
 * Every number on screen comes from the trip's own record (the people's answers, the seeded catalog, the ledger), and
 * a line a person did not give is never written for them: a person's line is built from what they answered.
 */

/** Who is speaking, and a line of the thread: Lane B's thread model, so the group reads like the one-to-one chat. */
export type GroupSender = Sender;
export type GroupLine = ThreadLine & {
  /** The first bubble of a run: the chip shows above it, and only above it. */
  first: boolean;
  /** The last bubble of a run: the sender's picture sits beside it. */
  last: boolean;
};

/** The words of the trip thread. Plain, whole dollars, no emoji, no em dashes. */
export const tripCopy = {
  seededDay: "Group chat, seeded for the demo",
  openerMichelle: "We NEED to do Japan next summer.",
  openerKai: "Same. Anime for me, and nothing with a lot of stairs, please.",
  youAsk: "Sprout, can you make this happen?",
  sproutOnIt: "On it. I'll ask each Muse one question, and only ask you what I can't answer for you.",
  sproutAsks: (names: string) => `${names}: what is your person's most for a flight, and one thing they want from the trip?`,
  askingPerson: (name: string) => `I'm asking ${name}.`,
  answeredYes: "Yes, that works.",
  answeredNo: (low: number) => `Not quite that much. ${money(low)} is my limit.`,
  answeredLimit: (limit: number) => `My limit is ${money(limit)}.`,
  museRelay: (name: string, limit: number, taste: string, constraint: string | null) =>
    `${name}'s limit for a flight is ${money(limit)}. ${constraint ? `${cap(taste)}, and ${constraint}.` : `${cap(taste)}.`}`,
  budgetLine: (amount: number) => `Everyone answered. Flights stay at or under ${money(amount)} each.`,
  outlineIntro: "Here is a first outline, picked from the seeded catalog and checked in code.",
  notBooked: "A few things I do not know, and I won't guess. Nothing here is booked.",
  potIntro: (perPerson: number) => `To hold the plan, each of you puts ${money(perPerson)} in a shared pot. Nothing moves until you each confirm your own.`,
  imIn: "I'm in.",
  imOut: "Not this time.",
  museIn: (name: string, deposit: number) => `${name} is in. ${money(deposit)} in the pot.`,
  museOut: (name: string) => `${name} is out. Nothing moved.`,
  allIn: (target: number) => `All three of you are in. ${money(target)} is in the pot. Nothing is booked.`,
  dropped: "The plan is off. Nothing moved for anyone who had not confirmed.",
  waitingFor: (names: string) => `waiting for ${names}`,
  asking: (muses: string) => `${muses} is asking`,
  composing: "Sprout is putting the plan together",
  allInStatus: "all three are in",
} as const;

/** "July 10 to 17, 2027" from the trip's horizon, read in Central like every time on screen. */
export function tripDates(trip: Pick<UiTrip, "horizon">): string {
  const part = (iso: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", ...options }).format(new Date(iso));
  const { start, end } = trip.horizon;
  const month = part(start, { month: "long" });
  const through = part(end, { month: "long" }) === month ? part(end, { day: "numeric" }) : part(end, { month: "long", day: "numeric" });
  return `${month} ${part(start, { day: "numeric" })} to ${through}, ${part(start, { year: "numeric" })}`;
}

/** The line under the group's name, from the reader's side: you first, then the others, then the three Muses. */
export function tripOwners(trip: UiTrip, viewer: MemberId): string {
  const you = trip.people.filter((person) => person.member === viewer).map(() => "You");
  const others = trip.people.filter((person) => person.member !== viewer).map((person) => person.name);
  return `${listOf([...you, ...others])}, with ${listOf(trip.people.map((person) => person.muse))}`;
}

export function money(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

const cap = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

/** The phone seat each role reads from; the second seat's person is Michelle, played by a model or a real friend. */
const viewerOf: Record<Role, MemberId> = { a: "aaron", b: "lisa" };

/**
 * Whose cards this phone carries: only its own person's. Kai is fictional and has no seat, so a model always plays them and
 * nobody answers for them from another phone; Michelle has a card on the second phone only when a real friend is there.
 */
export function cardsOnPhone(snapshot: Pick<UiSnapshot, "simulatedFriend">, role: Role): MemberId[] {
  if (role === "a") return ["aaron"];
  return snapshot.simulatedFriend ? [] : ["lisa"];
}

/**
 * The trip with its people named by the names rule (PR 72): a person nobody has named is "your friend", never a Muse's
 * name and never a new word; Michelle when a model plays her; Kai in every room. The reader's own "You" is the card's job.
 */
export function tripWithNames(snapshot: UiSnapshot, trip: UiTrip): UiTrip {
  const names = namesFor(snapshot);
  return { ...trip, people: trip.people.map((person) => (person.member === "kai" ? person : { ...person, name: names.human[person.member] })) };
}

export function personOf(trip: UiTrip, member: MemberId): UiTripPerson {
  return trip.people.find((person) => person.member === member)!;
}

/** What a person's answer says in their own words, built from the answer they gave and nothing else. */
export function answerText(trip: UiTrip, answer: UiTripAnswer): string {
  if (answer.answer === "yes") return tripCopy.answeredYes;
  if (answer.answer === "no") return tripCopy.answeredNo(trip.range.low);
  return tripCopy.answeredLimit(answer.limit);
}

/** The short word a person's answer shows as on the budget card: Yes, No, or their number. */
export function answerWord(answer: UiTripAnswer): string {
  return answer.answer === "yes" ? "Yes" : answer.answer === "no" ? "No" : money(answer.limit);
}

/** Who a line of an itinerary is for: the people whose taste or limit it serves. */
export function servedBy(trip: UiTrip, serves: string[]): string[] {
  return trip.people
    .filter((person) => {
      const wants = `${person.taste} ${person.constraint ?? ""}`.toLowerCase();
      return serves.some((tag) => wants.includes(tag.toLowerCase()));
    })
    .map((person) => person.name);
}

export type TripThread = { items: ChatItem[]; status: PhoneStatus | null; mood: AvatarMood };

export function tripThread(snapshot: UiSnapshot, role: Role): TripThread {
  const plan = snapshot.plan!;
  const trip = tripWithNames(snapshot, plan.trip!);
  const viewer = viewerOf[role];
  const mine = cardsOnPhone(snapshot, role);
  const answered = new Map(trip.answers.map((answer) => [answer.member, answer]));
  const replies = new Map(snapshot.messages.filter((message) => message.type === "trip_reply").map((message) => [message.from, message]));
  const asked = snapshot.messages.some((message) => message.type === "trip_ask");
  const relayed = new Set(snapshot.messages.filter((message) => message.type === "trip_answer").map((message) => message.from));

  const items: ChatItem[] = [];
  const lines: GroupLine[] = [];
  let counter = 0;
  const id = (prefix: string) => `${prefix}-${(counter += 1)}`;

  // Who is who, from this reader's side: "You" and "your Muse" for the phone's own person, owners for the rest.
  const person = (member: MemberId): GroupSender => {
    const about = personOf(trip, member);
    const simulated = member === "kai" || (member !== "aaron" && about.simulated);
    return member === viewer
      ? { kind: "you", name: "You" }
      : { kind: "friend", name: capital(about.name), simulated };
  };
  const muse = (member: MemberId): GroupSender => {
    const about = personOf(trip, member);
    return member === viewer
      ? { kind: "your-muse", name: about.muse, agent: member }
      : { kind: "friend-muse", name: about.muse, owner: member === "aaron" ? undefined : about.name, agent: member };
  };
  const say = (sender: GroupSender, text: string) => {
    const previous = items.at(-1);
    const first = !(previous?.kind === "group-line" && sameSender(previous.line.sender, sender));
    const line: GroupLine = { id: id("line"), sender, text, first, last: true };
    // A run's last bubble is the one with a different sender (or a card) after it, so the one before it stops being last.
    if (!first && previous?.kind === "group-line") previous.line.last = false;
    lines.push(line);
    items.push({ kind: "group-line", id: line.id, line });
  };
  const card = (item: ChatItem) => items.push(item);

  // The group chat that never made it out of the chat, then the judge asking for it.
  items.push({ kind: "separator", id: "sep-seeded", day: tripCopy.seededDay, time: "" });
  say(person("lisa"), tripCopy.openerMichelle);
  say(person("kai"), tripCopy.openerKai);
  say(person("aaron"), tripCopy.youAsk);
  say(muse("aaron"), tripCopy.sproutOnIt);
  if (asked) {
    const askedNames = trip.people.filter((entry) => entry.member !== "aaron").map((entry) => entry.muse);
    say(muse("aaron"), tripCopy.sproutAsks(listOf(askedNames)));
  }

  // Round 1: each person's answer, then their Muse relaying it. A card for a person who has still to answer comes last,
  // so it sits where the newest thing belongs, just above the composer.
  const open: ChatItem[] = [];
  for (const entry of trip.people) {
    const answer = answered.get(entry.member);
    if (answer) {
      say(person(entry.member), answerText(trip, answer));
      if (entry.member !== "aaron" && relayed.has(entry.member)) {
        say(muse(entry.member), tripCopy.museRelay(entry.name, answer.limit, answer.taste, answer.constraint));
      }
    } else if (plan.state === "negotiating") {
      if (mine.includes(entry.member)) {
        open.push({ kind: "trip-question", id: `question-${entry.member}`, planId: plan.id, member: entry.member, forName: entry.member === viewer ? null : entry.name, range: trip.range, route: `Round trip, Austin to ${trip.destination}, ${tripDates(trip)}` });
      } else if (entry.member !== "aaron" && asked) {
        say(muse(entry.member), tripCopy.askingPerson(entry.name));
      }
    }
  }

  for (const waiting of open) card(waiting);

  // Round 2: the cap, the outline and what is not known, the pot.
  if (trip.cap) {
    say(muse("aaron"), tripCopy.budgetLine(trip.cap.amount));
    card({ kind: "trip-budget", id: "budget", trip });
  }
  if (trip.itinerary) {
    say(muse("aaron"), `${tripCopy.outlineIntro} ${trip.itinerary.rationale}`);
    card({ kind: "trip-itinerary", id: "itinerary", trip });
    say(muse("aaron"), tripCopy.notBooked);
    card({ kind: "trip-open", id: "open", trip });
  }
  if (trip.pot) {
    say(muse("aaron"), tripCopy.potIntro(trip.pot.perPerson));
    card({ kind: "trip-pot", id: "pot", planId: plan.id, trip, answerable: mine, viewer, state: plan.state });
    // Round 3: each person's own yes or no, in their words, with their Muse telling the coordinator.
    for (const deposit of trip.pot.deposits) {
      const entry = personOf(trip, deposit.member);
      if (deposit.status === "confirmed") {
        say(person(deposit.member), tripCopy.imIn);
        if (deposit.member !== "aaron" && replies.get(deposit.member)) say(muse(deposit.member), tripCopy.museIn(entry.name, deposit.amount));
      } else if (deposit.status === "declined") {
        say(person(deposit.member), tripCopy.imOut);
        if (deposit.member !== "aaron") say(muse(deposit.member), tripCopy.museOut(entry.name));
      }
    }
  }
  if (plan.state === "confirmed" && trip.pot) say(muse("aaron"), tripCopy.allIn(trip.pot.target));
  if (plan.state === "dropped") say(muse("aaron"), trip.pot ? tripCopy.dropped : (trip.unknowns.at(-1) ?? tripCopy.dropped));

  return { items, ...statusOf(snapshot, role, trip, mine, answered) };
}

function sameSender(a: GroupSender, b: GroupSender): boolean {
  return a.kind === b.kind && a.name === b.name && a.owner === b.owner;
}

function statusOf(snapshot: UiSnapshot, role: Role, trip: UiTrip, mine: MemberId[], answered: Map<MemberId, UiTripAnswer>): { status: PhoneStatus | null; mood: AvatarMood } {
  const plan = snapshot.plan!;
  const viewer = viewerOf[role];
  if (plan.state === "negotiating") {
    const openForMe = mine.some((member) => !answered.has(member));
    if (openForMe) return { status: { glyph: "waiting-you", text: "waiting for you" }, mood: "idle" };
    if (trip.people.every((entry) => answered.has(entry.member))) return { status: { glyph: "thinking", text: tripCopy.composing }, mood: "thinking" };
    const waitingOn = trip.people.filter((entry) => entry.member !== "aaron" && !answered.has(entry.member)).map((entry) => entry.muse);
    return { status: { glyph: "talking", text: tripCopy.asking(listOf(waitingOn)) }, mood: "talking" };
  }
  if (plan.state === "awaiting_humans") {
    const pending = trip.pot?.deposits.filter((deposit) => deposit.status === "proposed" || deposit.status === "failed") ?? [];
    if (pending.some((deposit) => mine.includes(deposit.member))) return { status: { glyph: "waiting-you", text: "waiting for you" }, mood: "idle" };
    const names = pending.filter((deposit) => deposit.member !== viewer).map((deposit) => personOf(trip, deposit.member).name);
    return { status: names.length > 0 ? { glyph: "waiting-friend", text: tripCopy.waitingFor(listOf(names)) } : null, mood: "idle" };
  }
  if (plan.state === "confirmed") return { status: { glyph: "done", text: tripCopy.allInStatus }, mood: "idle" };
  return { status: null, mood: "idle" };
}
