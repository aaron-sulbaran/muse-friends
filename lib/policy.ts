import { z } from "zod";
import { closesThread, isForcedClose, nextThreadState } from "@/lib/agent/thread";
import { isSubsetOfBlocks, windowHash } from "@/lib/agent/windows";
import {
  AgentMessage,
  CATEGORIES,
  SHARED_CATEGORIES,
  categoriesInMessage,
  isCategoryAllowed,
  type MemberId,
  type Category,
  type Persona,
  type PolicyStamp,
  type Redaction,
  type SharePolicy,
  type Shared,
  type SharedCategory,
  type Thread,
  type Window,
} from "@/lib/protocol";

// Privacy enforced in code, outside the model. enforceSharePolicy runs at send after the model
// has written the message; the inbox re-validates at receive (validateIncoming, added with the
// inbox via validateIncoming below). Nothing here trusts the model to follow instructions.

// Words long enough to identify a private event but too common to be worth blocking on their own.
const COMMON_TITLE_WORDS = new Set(["friends", "meeting", "family"]);
const MIN_TITLE_TOKEN_LENGTH = 7;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mentions(text: string, phrase: string): boolean {
  const needle = normalize(phrase);
  return needle.length > 0 && normalize(text).includes(needle);
}

function titleTokens(title: string): string[] {
  return normalize(title)
    .split(" ")
    .filter((token) => token.length >= MIN_TITLE_TOKEN_LENGTH && !COMMON_TITLE_WORDS.has(token));
}

// Builds `shared` from the sender's own data for the categories the model asked to share and the
// policy allows. The model never supplies the values.
export function projectShared(
  persona: Persona,
  requested: SharedCategory[] | undefined,
  policy: SharePolicy | null,
): Shared | undefined {
  const shared: Shared = {};
  for (const category of requested ?? []) {
    const values = persona.interests[category];
    if (!values || values.length === 0 || !isCategoryAllowed(policy, category)) continue;
    shared[category] = values.slice(0, 5);
  }
  return Object.keys(shared).length > 0 ? shared : undefined;
}

export type PolicyOutcome = {
  message: AgentMessage;
  stamp: PolicyStamp;
  removed: Category[];
  // Present when something was removed. Never contains the removed value.
  redaction: Redaction | null;
};

type EnforceInput = {
  message: AgentMessage;
  policy: SharePolicy | null;
  sender: Persona;
  windowsDropped?: number;
};

// Text the model wrote: scanned for private event titles and for values from categories that are off.
// `topic` is the activity title the friend already knows about (the reel they sent), so naming it
// is not a leak; `eventsOnly` skips the interest values entirely (used for the title itself).
function scanText(
  text: string,
  policy: SharePolicy | null,
  sender: Persona,
  context: { place?: string; topic?: string; eventsOnly?: boolean },
): Category[] {
  const hits = new Set<Category>();
  for (const event of sender.calendar) {
    const privateHit = event.private && (mentions(text, event.title) || titleTokens(event.title).some((token) => mentions(text, token)));
    const plainHit = !event.private && !isCategoryAllowed(policy, "events") && mentions(text, event.title);
    if (privateHit || plainHit) hits.add("events");
  }
  if (context.eventsOnly) return CATEGORIES.filter((category) => hits.has(category));
  for (const category of SHARED_CATEGORIES) {
    if (isCategoryAllowed(policy, category)) continue;
    const values = (sender.interests[category] ?? []).filter((value) => !(context.topic && mentions(context.topic, value)));
    if (category === "location" && context.place) values.push(context.place);
    if (values.some((value) => mentions(text, value))) hits.add(category);
  }
  return CATEGORIES.filter((category) => hits.has(category));
}

const REMOVAL_TEXT: Record<Category, string> = {
  availability: "availability windows were removed",
  location: "the place and any location details were removed",
  food: "food details were removed",
  events: "text naming an event was removed",
  interests: "interest details were removed",
};

export function enforceSharePolicy({ message, policy, sender, windowsDropped = 0 }: EnforceInput): PolicyOutcome {
  const removed = new Set<Category>();
  const out: AgentMessage = structuredClone(message);
  const originalPlace = out.activity?.place;

  if (!isCategoryAllowed(policy, "availability") && out.windows?.length) {
    delete out.windows;
    removed.add("availability");
  }

  if (!isCategoryAllowed(policy, "location") && out.activity?.place) {
    delete out.activity.place;
    removed.add("location");
  }

  if (out.shared) {
    for (const category of SHARED_CATEGORIES) {
      if (out.shared[category] && !isCategoryAllowed(policy, category)) {
        delete out.shared[category];
        removed.add(category);
      }
    }
    if (Object.keys(out.shared).length === 0) delete out.shared;
  }

  if (out.note) {
    const hits = scanText(out.note, policy, sender, { place: originalPlace, topic: out.activity?.title });
    if (hits.length > 0) {
      delete out.note;
      for (const hit of hits) removed.add(hit);
    }
  }

  // What a payment says it is for is text the model wrote, scanned like a note.
  if (out.payment) {
    const hits = scanText(out.payment.reason, policy, sender, { place: originalPlace, topic: out.activity?.title });
    if (hits.length > 0) {
      out.payment.reason = "Settling up";
      for (const hit of hits) removed.add(hit);
    }
  }

  // A trip message's words are a person's or the seed's, scanned like a note: a private detail never travels in them.
  if (out.trip) {
    const text = (value: string | undefined, replacement: string | null): string | undefined => {
      if (!value) return value;
      const hits = scanText(value, policy, sender, { place: originalPlace, topic: out.activity?.title });
      if (hits.length === 0) return value;
      for (const hit of hits) removed.add(hit);
      return replacement ?? undefined;
    };
    out.trip.prompt = text(out.trip.prompt, "A question for you") ?? out.trip.prompt;
    out.trip.taste = text(out.trip.taste, "something") ?? out.trip.taste;
    out.trip.constraint = text(out.trip.constraint, null);
    if (out.trip.constraint === undefined) delete out.trip.constraint;
  }

  if (out.activity) {
    const hits = scanText(out.activity.title, policy, sender, { eventsOnly: true });
    if (hits.length > 0) {
      out.activity.title = "A plan";
      for (const hit of hits) removed.add(hit);
    }
  }

  const removedList = CATEGORIES.filter((category) => removed.has(category));
  const stamp: PolicyStamp = { passed: categoriesInMessage(out), removed: removedList, windowsDropped };
  const redaction: Redaction | null =
    removedList.length === 0
      ? null
      : {
          id: `red_${message.id}`,
          contextId: message.contextId,
          messageId: message.id,
          from: message.from,
          to: message.to,
          removed: removedList,
          detail: `Policy for ${sender.displayName}: ${removedList.map((category) => REMOVAL_TEXT[category]).join("; ")}.`,
          at: message.at,
        };

  return { message: out, stamp, removed: removedList, redaction };
}

// ---------------------------------------------------------------------------
// The start-path gate: no mutual follow, no thread
// ---------------------------------------------------------------------------

export const REFUSAL_REASONS = ["not_mutual"] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

// Fixed copy per reason code: what the timeline shows is chosen from here, never written by a model.
export const REFUSAL_TEXT: Record<RefusalReason, (name: string) => string> = {
  not_mutual: (name) => `No thread opened: you and ${name} do not follow each other.`,
};

export type StartGate = { ok: true } | { ok: false; reason: RefusalReason };

// Agents only coordinate between people who already know each other. A follow-up with a contact starts
// only if both people follow each other; the contact is named by the person, never picked by the agent.
export function startGate(contact: { youFollow: boolean; followsYou: boolean }): StartGate {
  return contact.youFollow && contact.followsYou ? { ok: true } : { ok: false, reason: "not_mutual" };
}

// ---------------------------------------------------------------------------
// Payments scope
// ---------------------------------------------------------------------------

// Whether this sender may send `amount` dollars for a plan that has already had `spent` dollars sent for it. Runs
// where the money is sent, and again in the receiver's inbox: both ends validate, neither trusts a model.
export function paymentsCheck(policy: SharePolicy | null, amount: number, spent: number): string | null {
  const scope = policy?.payments;
  if (!scope || !scope.enabled || scope.capPerPlan <= 0) return "Payments are off for this friend: your person has not allowed your Muse to send money.";
  if (!Number.isInteger(amount) || amount < 1) return "The amount must be a whole number of dollars, at least 1.";
  const left = scope.capPerPlan - spent;
  if (amount > left) return `That is over your person's cap of $${scope.capPerPlan} per plan: $${spent} is already sent for this plan, so at most $${Math.max(0, left)} more.`;
  return null;
}

// ---------------------------------------------------------------------------
// Receive side
// ---------------------------------------------------------------------------

export type IncomingCheck = { ok: true; message: AgentMessage } | { ok: false; status: 403 | 409 | 422; error: string };

type ValidateInput = {
  raw: unknown;
  // Who the bearer token says is calling.
  authenticatedSender: MemberId;
  // Whose inbox this is.
  recipient: MemberId;
  thread: Thread | null;
  prior: AgentMessage[];
  // The sender's own verified free blocks and sharing policy, read by trusted server code. The
  // receiving agent's model never sees either.
  senderFreeBlocks: Window[];
  senderPolicy: SharePolicy | null;
  senderPersona: Persona;
  rejectedWindowHashes: string[];
};

// Runs in the inbox before it answers 202: the same strict parse and caps, the identity and turn
// checks, windows inside the sender's verified free blocks, the rejected-window ledger, and the
// share policy applied once more. A message that fails is rejected and never reaches the other agent.
export function validateIncoming(input: ValidateInput): IncomingCheck {
  const parsed = AgentMessage.safeParse(input.raw);
  if (!parsed.success) return { ok: false, status: 422, error: `Invalid message. ${z.prettifyError(parsed.error)}` };
  const message = parsed.data;

  if (message.from !== input.authenticatedSender) return { ok: false, status: 403, error: "from does not match the authenticated sender" };
  if (message.to !== input.recipient) return { ok: false, status: 422, error: "to does not match this inbox" };

  const expectedSeq = (input.thread?.messageCount ?? 0) + 1;
  if (message.seq !== expectedSeq) return { ok: false, status: 409, error: `expected seq ${expectedSeq}` };
  if (input.thread && ["rejected", "failed", "completed", "input-required"].includes(input.thread.state)) {
    return { ok: false, status: 409, error: "the conversation has already ended" };
  }
  if (input.prior.at(-1)?.from === message.from) return { ok: false, status: 409, error: "not the sender's turn" };
  if (isForcedClose(message.seq) && !closesThread(message.type)) return { ok: false, status: 422, error: "the sixth message must be an accept or a decline" };
  if (message.state !== nextThreadState(message, input.prior)) return { ok: false, status: 422, error: "state does not follow from the thread" };

  for (const window of message.windows ?? []) {
    if (!isSubsetOfBlocks(window, input.senderFreeBlocks)) return { ok: false, status: 422, error: "a window is outside the sender's free blocks" };
    if (input.rejectedWindowHashes.includes(windowHash(window))) return { ok: false, status: 422, error: "a window was already passed over in this conversation" };
  }

  const check = enforceSharePolicy({ message, policy: input.senderPolicy, sender: input.senderPersona });
  if (check.removed.length > 0) {
    return { ok: false, status: 422, error: `the message carries data the sender's sharing policy does not allow (${check.removed.join(", ")})` };
  }

  return { ok: true, message };
}
