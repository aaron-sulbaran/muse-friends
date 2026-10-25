import { seatOf } from "@/lib/agent/ids";
import { describeWindow, toCentralIso, toMs, windowHash } from "@/lib/agent/windows";
import {
  categoriesInMessage,
  type ActivityEvent,
  type AgentId,
  type AgentMessage,
  type Category,
  type MessageRecord,
  type Plan,
  type PolicyStamp,
  type RecordedRun,
  type Recommendation,
  type Redaction,
  type Room,
  type SharePolicy,
  type Signal,
  type StateSnapshot,
  type Thread,
  type Window,
} from "@/lib/protocol";
import { DEMO_START, displayName } from "./personas";

export {
  AGENT_TO_ROLE,
  CALENDAR_RANGE,
  DEMO_START,
  ROLE_TO_AGENT,
  displayName,
  getPersona,
  PERSONAS,
  PRIVATE_STRINGS,
} from "./personas";

// Everything here is fictional demo data, labeled as seeded. The recorded shawarma thread is a
// scripted fixture so Lane B can render the whole timeline before any live agent exists; a real
// run recorded from live Muse Spark replaces it for Replay later.

export const SHAWARMA_SIGNAL_ID = "sig_shawarma_001";
export const SHAWARMA_CONTEXT_ID = "ctx_shawarma_001";
export const SHAWARMA_PLAN_ID = "plan_shawarma_001";
export const SHAWARMA_RUN_ID = "run_shawarma_scripted";

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

const allOn: SharePolicy["categories"] = {
  food: true,
  events: true,
  availability: true,
  location: true,
  interests: true,
};

const SPROUT = displayName("aaron");
const MOCHI = displayName("lisa");

// The demo room starts empty: both judges are people, no simulated friend.
export const DEFAULT_ROOM: Room = { id: "demo", simulatedFriend: false, resetCount: 0, updatedAt: DEMO_START };

// The two personas are close friends who share everything; the privacy toggle flips Lisa's location.
export const DEFAULT_POLICIES: SharePolicy[] = [
  { owner: "aaron", friend: "lisa", tier: "close", categories: { ...allOn } },
  { owner: "lisa", friend: "aaron", tier: "close", categories: { ...allOn } },
];

// ---------------------------------------------------------------------------
// The seeded reel signal
// ---------------------------------------------------------------------------

const RUN_START_MS = toMs(DEMO_START);
function at(secondsAfterStart: number): string {
  return toCentralIso(RUN_START_MS + secondsAfterStart * 1000);
}

const reelCaption =
  "Best shawarma in Austin?? The garlic sauce at Shawarma Point on E 6th St is unreal. " +
  "Open until 9, closed Sundays. Tag someone you'd go with 🌯 #austineats #shawarma";

// The reel as it arrives: no extraction yet. The live agent fills `extracted` from the caption.
export function rawShawarmaSignal(): Signal {
  return {
    id: SHAWARMA_SIGNAL_ID,
    kind: "reel_share",
    from: "lisa",
    to: "aaron",
    dmText: "we should go!!",
    media: {
      id: "17900000000000001",
      media_type: "VIDEO",
      media_product_type: "REELS",
      caption: reelCaption,
      permalink: "https://example.com/reel/seed-shawarma-001",
      thumbnail_url: "https://example.com/reel/seed-shawarma-001/thumb.jpg",
      timestamp: "2026-10-03T19:12:00-05:00",
      username: "eastside.eats.atx",
    },
    provenance: {
      source: "seeded",
      shapedLike: "Instagram Graph API media fields",
      fictional: true,
      note: "Seeded demo reel and account. Shaped like Instagram Graph API media fields; nothing is pulled from Instagram.",
    },
    receivedAt: at(0),
  };
}

// The same reel after Muse Spark read its caption.
export function extractedShawarmaSignal(): Signal {
  return {
    ...rawShawarmaSignal(),
    extracted: {
      source: "caption_model",
      model: "muse-spark-1.3",
      place: "Shawarma Point",
      area: "E 6th St, Austin",
      cuisine: "shawarma",
      hours: "Open until 9pm, closed Sundays",
      at: at(4),
    },
  };
}

// The opening beat: the same reel, sent to Aaron weeks ago, never acted on.
export function deadReelSignal(): Signal {
  return {
    ...rawShawarmaSignal(),
    id: "sig_shawarma_dead",
    receivedAt: "2026-10-04T12:30:00-05:00",
  };
}

// ---------------------------------------------------------------------------
// The recorded shawarma thread: six messages, ending in accept from both agents
// ---------------------------------------------------------------------------

const MON_LATE: Window = { start: "2026-10-26T21:00:00-05:00", end: "2026-10-26T22:00:00-05:00" };
const TUE_EVENING: Window = { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" };
const WED_SHORT: Window = { start: "2026-10-28T18:00:00-05:00", end: "2026-10-28T19:30:00-05:00" };

const SHAWARMA_ACTIVITY = { kind: "food", title: "Shawarma Point", place: "E 6th St" } as const;

function stampFor(message: AgentMessage, removed: Category[] = []): PolicyStamp {
  return { passed: categoriesInMessage(message), removed, windowsDropped: 0 };
}

function record(message: AgentMessage, removed: Category[] = []): MessageRecord {
  return { message, stamp: stampFor(message, removed), delivery: "delivered", httpStatus: 202 };
}

function base(seq: number, from: AgentId, secondsAfterStart: number) {
  return {
    id: `msg_shawarma_${String(seq).padStart(3, "0")}`,
    contextId: SHAWARMA_CONTEXT_ID,
    seq,
    from,
    to: from === "aaron" ? ("lisa" as const) : ("aaron" as const),
    at: at(secondsAfterStart),
  };
}

const shawarmaMessages: AgentMessage[] = [
  {
    ...base(1, "aaron", 8),
    type: "intent",
    state: "working",
    activity: { ...SHAWARMA_ACTIVITY },
    reason: "interest_match",
    note: `Saw ${MOCHI}'s reel and I'm hungry. Want to make it happen this week?`,
    shared: { food: ["shawarma", "ramen", "breakfast tacos"] },
  },
  {
    ...base(2, "lisa", 14),
    type: "propose",
    state: "working",
    activity: { ...SHAWARMA_ACTIVITY },
    windows: [MON_LATE, TUE_EVENING, WED_SHORT],
    reason: "interest_match",
    note: "Yes to shawarma. These are my open evenings this week.",
    shared: { food: ["shawarma", "dumplings", "matcha"], location: ["East Austin"] },
  },
  {
    ...base(3, "aaron", 20),
    type: "counter",
    state: "working",
    windows: [TUE_EVENING],
    reason: "both_free",
    note: "Monday is after close and Wednesday is short. Tuesday 6 to 8 is open on my side.",
  },
  {
    ...base(4, "lisa", 26),
    type: "counter",
    state: "working",
    windows: [TUE_EVENING],
    reason: "both_free",
    note: "Tuesday works. I'll aim for 6:30 so I can get there after class.",
  },
  {
    ...base(5, "aaron", 31),
    type: "accept",
    state: "working",
    windows: [TUE_EVENING],
    reason: "both_free",
    note: "6:30 is good. See you there.",
  },
  {
    ...base(6, "lisa", 36),
    type: "accept",
    state: "input-required",
    windows: [TUE_EVENING],
    reason: "both_free",
    note: "Agreed. Asking my human now.",
  },
];

function messageEvent(message: AgentMessage): ActivityEvent {
  const windows = message.windows?.map(describeWindow).join(", ");
  return {
    id: `evt_${message.id}`,
    at: message.at,
    kind: "message_sent",
    actor: "agent",
    agent: seatOf(message.from),
    contextId: message.contextId,
    messageId: message.id,
    text: `${displayName(message.from)} sent ${message.type}${windows ? `: ${windows}` : ""}`,
  };
}

const draft =
  `Hey ${MOCHI}, that shawarma reel stuck with me. Tuesday 6 to 8 works for both of us. ` +
  "Want to meet at Shawarma Point around 6:30?";

const thread: Thread = {
  contextId: SHAWARMA_CONTEXT_ID,
  planId: SHAWARMA_PLAN_ID,
  signalId: SHAWARMA_SIGNAL_ID,
  initiator: "aaron",
  participants: ["aaron", "lisa"],
  state: "input-required",
  messageCount: 6,
  createdAt: at(6),
  updatedAt: at(36),
};

const plan: Plan = {
  id: SHAWARMA_PLAN_ID,
  contextId: SHAWARMA_CONTEXT_ID,
  initiator: "aaron",
  participants: ["aaron", "lisa"],
  state: "awaiting_humans",
  activity: { ...SHAWARMA_ACTIVITY },
  window: TUE_EVENING,
  decisions: { aaron: "pending", lisa: "pending" },
  draft,
  history: [
    { state: "detected", at: at(4), note: "Reel caption read" },
    { state: "negotiating", at: at(6) },
    { state: "awaiting_humans", at: at(37), note: "Both agents accepted" },
  ],
  createdAt: at(4),
  updatedAt: at(37),
};

const cards: Recommendation[] = [
  {
    id: "card_shawarma_aaron",
    planId: SHAWARMA_PLAN_ID,
    forAgent: "aaron",
    friend: "lisa",
    text: `You and ${MOCHI} both want to try Shawarma Point, and you're both free ${describeWindow(TUE_EVENING)}. Reach out?`,
    activity: { ...SHAWARMA_ACTIVITY },
    window: TUE_EVENING,
    draft,
    status: "pending",
    createdAt: at(38),
  },
  {
    id: "card_shawarma_lisa",
    planId: SHAWARMA_PLAN_ID,
    forAgent: "lisa",
    friend: "aaron",
    text: `${SPROUT} and you agreed on Shawarma Point, ${describeWindow(TUE_EVENING)}. Expect a message from ${SPROUT} and confirm when it lands.`,
    activity: { ...SHAWARMA_ACTIVITY },
    window: TUE_EVENING,
    status: "pending",
    createdAt: at(38),
  },
];

const events: ActivityEvent[] = [
  {
    id: "evt_signal",
    at: at(0),
    kind: "signal_received",
    actor: "human",
    agent: "lisa",
    contextId: SHAWARMA_CONTEXT_ID,
    planId: SHAWARMA_PLAN_ID,
    text: `${MOCHI} shared a reel with ${SPROUT}: "we should go!!"`,
  },
  {
    id: "evt_caption",
    at: at(4),
    kind: "caption_extracted",
    actor: "agent",
    agent: "aaron",
    contextId: SHAWARMA_CONTEXT_ID,
    planId: SHAWARMA_PLAN_ID,
    text: `${SPROUT} read the reel caption: Shawarma Point, E 6th St, open until 9pm (extracted from caption)`,
  },
  {
    id: "evt_thread",
    at: at(6),
    kind: "thread_opened",
    actor: "agent",
    agent: "aaron",
    contextId: SHAWARMA_CONTEXT_ID,
    planId: SHAWARMA_PLAN_ID,
    text: `${SPROUT} opened a thread with ${MOCHI}`,
  },
  ...shawarmaMessages.map(messageEvent),
  {
    id: "evt_awaiting",
    at: at(37),
    kind: "plan_state",
    actor: "system",
    contextId: SHAWARMA_CONTEXT_ID,
    planId: SHAWARMA_PLAN_ID,
    text: `${SPROUT} and ${MOCHI} agreed on ${describeWindow(TUE_EVENING)}. Waiting on both people.`,
  },
  {
    id: "evt_card_aaron",
    at: at(38),
    kind: "card_created",
    actor: "agent",
    agent: "aaron",
    contextId: SHAWARMA_CONTEXT_ID,
    planId: SHAWARMA_PLAN_ID,
    text: `Card for ${SPROUT}: reach out to ${MOCHI} about Shawarma Point`,
  },
  {
    id: "evt_card_lisa",
    at: at(38),
    kind: "card_created",
    actor: "agent",
    agent: "lisa",
    contextId: SHAWARMA_CONTEXT_ID,
    planId: SHAWARMA_PLAN_ID,
    text: `Card for ${MOCHI}: ${SPROUT} is about to reach out`,
  },
];

export function seedSnapshot(): StateSnapshot {
  return structuredClone({
    room: DEFAULT_ROOM,
    clock: { now: DEMO_START },
    busy: [],
    signals: [],
    threads: [],
    messages: [],
    plans: [],
    cards: [],
    policies: DEFAULT_POLICIES,
    redactions: [],
    events: [],
    rejectedWindows: {},
  });
}

export function recordedSnapshot(): StateSnapshot {
  return structuredClone({
    room: DEFAULT_ROOM,
    clock: { now: at(38) },
    busy: [],
    signals: [extractedShawarmaSignal()],
    threads: [thread],
    messages: shawarmaMessages.map((message) => record(message)),
    plans: [plan],
    cards,
    policies: DEFAULT_POLICIES,
    redactions: [],
    events,
    // Mon 9 to 10pm and Wed 6 to 7:30pm were proposed by Lisa's agent and passed over by Aaron's.
    rejectedWindows: { [SHAWARMA_CONTEXT_ID]: [windowHash(MON_LATE), windowHash(WED_SHORT)] },
  });
}

export function shawarmaRun(): RecordedRun {
  return {
    id: SHAWARMA_RUN_ID,
    label: "Shawarma thread (scripted fixture)",
    scenario: "shawarma",
    source: "scripted",
    recordedAt: at(40),
    snapshot: recordedSnapshot(),
  };
}

// ---------------------------------------------------------------------------
// The privacy toggle beat: Lisa turns location off for Aaron and her propose replays
// ---------------------------------------------------------------------------

export function privacyToggleDemo() {
  const policyBefore = structuredClone(DEFAULT_POLICIES[1]);
  const policyAfter: SharePolicy = { ...structuredClone(policyBefore), categories: { ...policyBefore.categories, location: false } };

  const original = shawarmaMessages[1];
  const replayed: AgentMessage = {
    ...original,
    at: at(70),
    activity: { kind: SHAWARMA_ACTIVITY.kind, title: SHAWARMA_ACTIVITY.title },
    shared: { food: original.shared?.food },
  };

  const redaction: Redaction = {
    id: "red_shawarma_002",
    contextId: SHAWARMA_CONTEXT_ID,
    messageId: original.id,
    from: "lisa",
    to: "aaron",
    removed: ["location"],
    detail: `Location is off for ${SPROUT}: the place and the shared location list were removed before sending.`,
    at: at(70),
  };

  const toggleEvents: ActivityEvent[] = [
    {
      id: "evt_policy_toggle",
      at: at(68),
      kind: "policy_changed",
      actor: "human",
      agent: "lisa",
      contextId: SHAWARMA_CONTEXT_ID,
      text: `${MOCHI} turned location off for ${SPROUT}`,
    },
    {
      id: "evt_redaction_002",
      at: at(70),
      kind: "redaction",
      actor: "system",
      agent: "lisa",
      contextId: SHAWARMA_CONTEXT_ID,
      messageId: original.id,
      redactionId: redaction.id,
      text: `Policy removed location from ${MOCHI}'s propose`,
    },
  ];

  return {
    policyBefore,
    policyAfter,
    messageBefore: record(original),
    messageAfter: record(replayed, ["location"]),
    redaction,
    events: toggleEvents,
  };
}
