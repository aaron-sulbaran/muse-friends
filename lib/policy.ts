import {
  CATEGORIES,
  SHARED_CATEGORIES,
  categoriesInMessage,
  isCategoryAllowed,
  type AgentMessage,
  type Category,
  type Persona,
  type PolicyStamp,
  type Redaction,
  type SharePolicy,
  type Shared,
  type SharedCategory,
} from "@/lib/protocol";

// Privacy enforced in code, outside the model. enforceSharePolicy runs at send after the model
// has written the message; the inbox re-validates at receive (validateIncoming, added with the
// inbox). Nothing here trusts the model to follow instructions.

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
