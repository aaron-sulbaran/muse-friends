import { z } from "zod";

// The one shared contract. Lane B imports types from here and never edits it.
// The wire message (AgentMessage) follows docs/TECH_SPEC.md "Protocol". Everything the
// Store, the state API, and Replay carry is also defined here so the lanes meet in one file.

// ---------------------------------------------------------------------------
// Vocabulary and limits
// ---------------------------------------------------------------------------

export const AGENT_IDS = ["aaron", "lisa"] as const;
export const AgentId = z.enum(AGENT_IDS);
export type AgentId = z.infer<typeof AgentId>;
// Everyone who can sit on the wire: the two phone seats plus a third seeded friend (Pebble) who joins
// group plans. AgentId stays the two-person pair every existing flow knows; MemberId is the superset
// used by the fields a group needs (message from and to, policies, cards, timeline rows).
export const MEMBER_IDS = ["aaron", "lisa", "kai"] as const;
export const MemberId = z.enum(MEMBER_IDS);
export type MemberId = z.infer<typeof MemberId>;

// The two phones. Role "a" is the first judge's side, "b" the second (or the simulated friend).
// AgentId stays internal; people see the persona's displayName.
export const ROLES = ["a", "b"] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

export const CATEGORIES = ["food", "events", "availability", "location", "interests"] as const;
export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;

// Categories whose content may ride in `shared`. Availability only ever travels as `windows`.
export const SHARED_CATEGORIES = ["food", "events", "location", "interests"] as const;
export const SharedCategory = z.enum(SHARED_CATEGORIES);
export type SharedCategory = z.infer<typeof SharedCategory>;

export const THREAD_CAP = 6;
export const MAX_WINDOWS = 3;
export const MAX_WINDOW_HOURS = 3;
export const NOTE_MAX = 140;
export const TITLE_MAX = 60;

export const MESSAGE_TYPES = ["intent", "propose", "counter", "accept", "decline"] as const;
export const MessageType = z.enum(MESSAGE_TYPES);
export type MessageType = z.infer<typeof MessageType>;

// A2A v0.3 task-state names, the subset this protocol uses.
export const TASK_STATES = ["working", "input-required", "completed", "rejected", "failed"] as const;
export const TaskState = z.enum(TASK_STATES);
export type TaskState = z.infer<typeof TaskState>;

export const REASONS = ["both_free", "interest_match", "no_overlap", "not_interested", "cap_reached"] as const;
export const Reason = z.enum(REASONS);
export type Reason = z.infer<typeof Reason>;

export const PLAN_STATES = [
  "detected",
  "negotiating",
  "awaiting_humans",
  "confirmed",
  "scheduled",
  "reminded",
  "happened",
  "followed_up",
  "dropped",
] as const;
export const PlanState = z.enum(PLAN_STATES);
export type PlanState = z.infer<typeof PlanState>;

// cap_reached is only the real cap (6 messages). agent_unavailable: an agent could not reply (the model failed
// and the scripted fallback could not send either).
export const DROP_REASONS = ["cap_reached", "declined", "no_overlap", "policy_blocked", "failed", "agent_unavailable"] as const;
export const DropReason = z.enum(DROP_REASONS);
export type DropReason = z.infer<typeof DropReason>;

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

const Id = z.string().min(1).max(64);

// ISO 8601 with an explicit offset. The demo runs in US Central (UTC-05:00 that week).
export const IsoDateTime = z.iso.datetime({ offset: true }).describe("ISO 8601 with offset, for example 2026-10-27T18:00:00-05:00");

export const Window = z
  .strictObject({ start: IsoDateTime, end: IsoDateTime })
  .refine((w) => Date.parse(w.end) > Date.parse(w.start), {
    message: "window end must be after start",
    path: ["end"],
  });
export type Window = z.infer<typeof Window>;

export const Activity = z.strictObject({
  kind: Category,
  title: z.string().min(1).max(TITLE_MAX),
  place: z.string().min(1).max(60).optional().describe("The street or area from the reel, not the venue name"),
});
export type Activity = z.infer<typeof Activity>;

const ShortList = z.array(z.string().min(1).max(40)).max(5);

// Allowlist-projected by the runtime from the sender's own data; never copied from model output.
// No `availability` key exists on purpose: availability only travels as `windows`.
export const Shared = z.strictObject({
  food: ShortList.optional(),
  events: ShortList.optional(),
  interests: ShortList.optional(),
  location: ShortList.optional(),
});
export type Shared = z.infer<typeof Shared>;

// ---------------------------------------------------------------------------
// The wire message
// ---------------------------------------------------------------------------

type WindowRuleInput = {
  type: MessageType;
  reason: Reason;
  windows?: Window[];
};

// Window rules per message type, shared by the wire message and the model-authored draft.
function checkWindowRules(value: WindowRuleInput, ctx: z.RefinementCtx) {
  const count = value.windows?.length ?? 0;
  const issue = (message: string) => ctx.addIssue({ code: "custom", message, path: ["windows"] });
  switch (value.type) {
    case "intent":
      return;
    case "propose":
      if (count < 1) issue("propose needs 1 to 3 windows");
      return;
    case "counter":
      if (count < 1 && value.reason !== "no_overlap" && value.reason !== "cap_reached") {
        issue("counter needs 1 to 3 windows unless reason is no_overlap or cap_reached");
      }
      return;
    case "accept":
      if (count !== 1) issue("accept needs exactly 1 window, the one being accepted");
      return;
    case "decline":
      if (count > 0) issue("decline carries no windows");
      return;
  }
}

export const AgentMessage = z
  .strictObject({
    id: Id,
    contextId: Id,
    seq: z.number().int().min(1).max(THREAD_CAP),
    from: MemberId,
    to: MemberId,
    type: MessageType,
    state: TaskState,
    activity: Activity.optional(),
    windows: z.array(Window).max(MAX_WINDOWS).optional(),
    reason: Reason,
    note: z.string().max(NOTE_MAX).optional(),
    shared: Shared.optional(),
    at: IsoDateTime,
  })
  .superRefine((message, ctx) => {
    if (message.from === message.to) {
      ctx.addIssue({ code: "custom", message: "from and to must differ", path: ["to"] });
    }
    checkWindowRules(message, ctx);
  });
export type AgentMessage = z.infer<typeof AgentMessage>;

// What the model authors through `send_to_friend_agent`. The runtime fills id, contextId, seq,
// from, to, state, at, and builds `shared` from `share` through the sender's allowlist, so a
// model can never forge identity, position, or state.
const MessageDraftShape = z.strictObject({
  type: MessageType.describe("intent opens, propose offers windows, counter answers with other windows, accept agrees to ONE window, decline ends it"),
  reason: Reason.describe("both_free: checked and it works; interest_match: shared interest; no_overlap: nothing fits; not_interested; cap_reached: out of messages"),
  activity: Activity.optional().describe("What the plan is, for example kind food, title Shawarma Point"),
  windows: z.array(Window).max(MAX_WINDOWS).optional().describe("Up to 3 windows copied exactly from your free blocks"),
  note: z.string().max(NOTE_MAX).optional().describe("One friendly sentence, max 140 characters, no private details"),
  share: z.array(SharedCategory).max(SHARED_CATEGORIES.length).optional().describe("Categories of your interests to share, if your person allows it"),
});

export const MessageDraft = MessageDraftShape.superRefine(checkWindowRules);
export type MessageDraft = z.infer<typeof MessageDraft>;

export const SendToFriendArgs = MessageDraftShape.extend({
  friend: MemberId.describe('The friend\'s agent id, exactly "aaron", "lisa", or "kai" (not a display name)'),
}).superRefine(checkWindowRules);
export type SendToFriendArgs = z.infer<typeof SendToFriendArgs>;

// Categories whose content is present in a message. Availability means windows, location
// means a place or a shared location list.
export function categoriesInMessage(message: {
  activity?: { place?: string };
  windows?: unknown[];
  shared?: Shared;
}): Category[] {
  const present = new Set<Category>();
  if (message.windows && message.windows.length > 0) present.add("availability");
  if (message.activity?.place) present.add("location");
  for (const key of SHARED_CATEGORIES) {
    if (message.shared?.[key] && message.shared[key].length > 0) present.add(key);
  }
  return CATEGORIES.filter((category) => present.has(category));
}

// ---------------------------------------------------------------------------
// Sharing policy and what enforcement leaves behind
// ---------------------------------------------------------------------------

export const SHARE_TIERS = ["close", "friend", "off"] as const;
export const ShareTier = z.enum(SHARE_TIERS);
export type ShareTier = z.infer<typeof ShareTier>;

// `owner` is whose policy this is; `friend` is who it governs. A new friend defaults to tier "off".
export const SharePolicy = z
  .strictObject({
    owner: MemberId,
    friend: MemberId,
    tier: ShareTier,
    categories: z.partialRecord(Category, z.boolean()),
  })
  .refine((policy) => policy.owner !== policy.friend, { message: "owner and friend must differ", path: ["friend"] });
export type SharePolicy = z.infer<typeof SharePolicy>;

// Tier defaults; explicit entries in `categories` override these. Tier "off" shares nothing.
export const TIER_DEFAULTS: Record<ShareTier, Record<Category, boolean>> = {
  close: { food: true, events: true, availability: true, location: true, interests: true },
  friend: { food: true, events: true, availability: true, location: false, interests: true },
  off: { food: false, events: false, availability: false, location: false, interests: false },
};

export function isCategoryAllowed(policy: SharePolicy | null | undefined, category: Category): boolean {
  if (!policy || policy.tier === "off") return false;
  return policy.categories[category] ?? TIER_DEFAULTS[policy.tier][category];
}

// Shown on every message row of the Activity timeline.
export const PolicyStamp = z.strictObject({
  passed: z.array(Category),
  removed: z.array(Category),
  windowsDropped: z.number().int().min(0),
});
export type PolicyStamp = z.infer<typeof PolicyStamp>;

// Never carries the removed value, only which categories were removed and why.
export const Redaction = z.strictObject({
  id: Id,
  contextId: Id,
  messageId: Id,
  from: MemberId,
  to: MemberId,
  removed: z.array(Category).min(1),
  detail: z.string().max(160),
  at: IsoDateTime,
});
export type Redaction = z.infer<typeof Redaction>;

// Evidence that a model call produced the message: shown on the Activity row so a judge can see the
// agent link is live. Absent on scripted fixtures, which no model wrote.
export const ModelProof = z.strictObject({
  model: z.string().max(40),
  responseId: z.string().max(80),
  latencyMs: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  reasoningTokens: z.number().int().min(0),
});
export type ModelProof = z.infer<typeof ModelProof>;

// A message as stored and shown: the wire message plus its policy stamp and delivery outcome.
export const MessageRecord = z.strictObject({
  message: AgentMessage,
  stamp: PolicyStamp,
  proof: ModelProof.optional(),
  delivery: z.enum(["delivered", "rejected", "failed"]),
  httpStatus: z.number().int().optional(),
  error: z.string().max(200).optional(),
});
export type MessageRecord = z.infer<typeof MessageRecord>;

// ---------------------------------------------------------------------------
// Threads, plans, cards
// ---------------------------------------------------------------------------

export const Thread = z.strictObject({
  contextId: Id,
  planId: Id,
  signalId: Id.optional(),
  // Set on each pair thread of a group plan (the coordinator's thread with one member).
  groupId: Id.optional(),
  initiator: MemberId,
  participants: z.tuple([MemberId, MemberId]),
  state: TaskState,
  messageCount: z.number().int().min(0).max(THREAD_CAP),
  dropReason: DropReason.optional(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Thread = z.infer<typeof Thread>;

export const Decision = z.enum(["pending", "accepted", "declined"]);
export type Decision = z.infer<typeof Decision>;

export const PlanHistoryEntry = z.strictObject({
  state: PlanState,
  at: IsoDateTime,
  note: z.string().max(160).optional(),
});
export type PlanHistoryEntry = z.infer<typeof PlanHistoryEntry>;

// The group part of a plan: three agents agreeing on one thing, star topology. The coordinator's agent opens one
// pair thread with each other member (the existing two-person protocol, unchanged); code intersects every
// member's windows; the plan moves to awaiting_humans when every pair thread has agreed.
export const PlanGroup = z.strictObject({
  groupId: Id,
  coordinator: MemberId,
  // Everyone in the plan, the coordinator first.
  members: z.array(MemberId).min(3).max(3),
  // Member -> the contextId of the coordinator's pair thread with them. The coordinator has none.
  contexts: z.partialRecord(MemberId, Id),
  // Every member's answer, the coordinator's and the third friend's included. The two phone seats are mirrored
  // into Plan.decisions so everything that reads that keeps working.
  decisions: z.partialRecord(MemberId, Decision),
  // Coordinator rounds used, at most 2: round 1 gathers every member's free windows, round 2 confirms one.
  rounds: z.number().int().min(0).max(2),
  // All members have to be in; there is no "most people" yet.
  quorum: z.literal("all"),
});
export type PlanGroup = z.infer<typeof PlanGroup>;

export const Plan = z.strictObject({
  id: Id,
  contextId: Id,
  initiator: AgentId,
  participants: z.tuple([AgentId, AgentId]),
  state: PlanState,
  activity: Activity.optional(),
  window: Window.optional(),
  decisions: z.record(AgentId, Decision),
  // Present when this plan is a group of three.
  group: PlanGroup.optional(),
  draft: z.string().max(500).optional(),
  dropReason: DropReason.optional(),
  history: z.array(PlanHistoryEntry),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Plan = z.infer<typeof Plan>;

// The one card a human sees. Only the initiator's card carries a WhatsApp draft.
export const Recommendation = z.strictObject({
  id: Id,
  planId: Id,
  forAgent: MemberId,
  friend: MemberId,
  // Set on the cards of a group plan: who is in it. "friend" is then the coordinator for a member, and for
  // the coordinator the first other member; the card text names everyone.
  group: z.strictObject({ groupId: Id, members: z.array(MemberId).min(3).max(3) }).optional(),
  text: z.string().min(1).max(240),
  activity: Activity,
  window: Window,
  draft: z.string().max(500).optional(),
  status: Decision,
  createdAt: IsoDateTime,
});
export type Recommendation = z.infer<typeof Recommendation>;

// ---------------------------------------------------------------------------
// Personas and signals (seeded, fictional)
// ---------------------------------------------------------------------------

export const CalendarEvent = z.strictObject({
  id: Id,
  title: z.string().min(1).max(80),
  start: IsoDateTime,
  end: IsoDateTime,
  // Private titles never leave the owner's agent, in a note or anywhere else.
  private: z.boolean(),
});
export type CalendarEvent = z.infer<typeof CalendarEvent>;

export const Persona = z.strictObject({
  id: MemberId,
  // The phone seat, when there is one. The third friend in a group has no phone of their own.
  role: Role.optional(),
  displayName: z.string().min(1).max(40),
  calendar: z.array(CalendarEvent),
  interests: z.partialRecord(SharedCategory, z.array(z.string().min(1).max(40))),
  provenance: z.strictObject({
    source: z.literal("seeded"),
    fictional: z.literal(true),
    note: z.string().max(200),
  }),
});
export type Persona = z.infer<typeof Persona>;

// Instagram Graph API media fields: seeded and fictional, or read live from the owner's own account (lib/instagram.ts).
export const ReelMedia = z.strictObject({
  id: Id,
  media_type: z.enum(["IMAGE", "VIDEO", "CAROUSEL_ALBUM"]),
  media_product_type: z.enum(["REELS", "FEED", "STORY"]),
  caption: z.string().max(2200),
  permalink: z.string().max(200),
  // Instagram's CDN links run about 600 characters.
  thumbnail_url: z.string().max(2000).optional(),
  timestamp: IsoDateTime,
  username: z.string().max(40),
});
export type ReelMedia = z.infer<typeof ReelMedia>;

export const SignalExtraction = z.strictObject({
  source: z.enum(["caption_model", "seeded"]),
  model: z.string().max(40).optional(),
  place: z.string().max(80).optional(),
  area: z.string().max(80).optional(),
  cuisine: z.string().max(40).optional(),
  hours: z.string().max(80).optional(),
  at: IsoDateTime,
});
export type SignalExtraction = z.infer<typeof SignalExtraction>;

export const Signal = z.strictObject({
  id: Id,
  kind: z.literal("reel_share"),
  from: AgentId,
  to: AgentId,
  dmText: z.string().max(200).optional(),
  media: ReelMedia,
  provenance: z.strictObject({
    source: z.enum(["seeded", "instagram_graph_api"]),
    shapedLike: z.literal("Instagram Graph API media fields"),
    fictional: z.boolean(),
    note: z.string().max(200),
  }),
  extracted: SignalExtraction.optional(),
  receivedAt: IsoDateTime,
});
export type Signal = z.infer<typeof Signal>;

// ---------------------------------------------------------------------------
// Activity timeline, clock, snapshot, recorded run
// ---------------------------------------------------------------------------

export const ACTIVITY_KINDS = [
  "signal_received",
  "caption_extracted",
  "thread_opened",
  "message_sent",
  "message_rejected",
  "redaction",
  "plan_state",
  "card_created",
  "human_decision",
  "handoff_opened",
  "hold_issued",
  "followed_through",
  "clock_advanced",
  "policy_changed",
  "busy_added",
  "room_reset",
  "turn_failed",
] as const;
export const ActivityKind = z.enum(ACTIVITY_KINDS);
export type ActivityKind = z.infer<typeof ActivityKind>;

// One timeline row. `text` is ready to render. `actor` "human" marks taps and sends by a person.
// The Follow-through counter counts events of kind "followed_through" only: the plan happened.
export const ActivityEvent = z.strictObject({
  id: Id,
  at: IsoDateTime,
  kind: ActivityKind,
  actor: z.enum(["agent", "human", "system"]),
  // Absent on the third friend's rows (Pebble has no phone seat); the text names them.
  agent: AgentId.optional(),
  contextId: Id.optional(),
  planId: Id.optional(),
  messageId: Id.optional(),
  redactionId: Id.optional(),
  text: z.string().min(1).max(240),
});
export type ActivityEvent = z.infer<typeof ActivityEvent>;

// The simulated "now" used by the plan lifecycle (reminder, happened, follow-up).
export const DemoClock = z.strictObject({ now: IsoDateTime });
export type DemoClock = z.infer<typeof DemoClock>;

// The single demo room. `simulatedFriend` means side b is played by a model (Michelle) because
// only one judge is present; the UI must label it.
export const Room = z.strictObject({
  id: z.literal("demo"),
  simulatedFriend: z.boolean(),
  resetCount: z.number().int().min(0),
  updatedAt: IsoDateTime,
});
export type Room = z.infer<typeof Room>;

// A busy block a judge adds from the controls; get_my_calendar merges these into the persona's calendar.
export const BusyBlock = z.strictObject({ agent: AgentId, event: CalendarEvent });
export type BusyBlock = z.infer<typeof BusyBlock>;

export const StateSnapshot = z.strictObject({
  room: Room,
  clock: DemoClock,
  busy: z.array(BusyBlock),
  signals: z.array(Signal),
  threads: z.array(Thread),
  messages: z.array(MessageRecord),
  plans: z.array(Plan),
  cards: z.array(Recommendation),
  policies: z.array(SharePolicy),
  redactions: z.array(Redaction),
  events: z.array(ActivityEvent),
  // contextId -> hashes of windows that were proposed and then passed over
  rejectedWindows: z.record(z.string(), z.array(z.string())),
});
export type StateSnapshot = z.infer<typeof StateSnapshot>;

export const RecordedRun = z.strictObject({
  id: Id,
  label: z.string().max(80),
  scenario: z.literal("shawarma"),
  source: z.enum(["scripted", "live"]),
  recordedAt: IsoDateTime,
  snapshot: StateSnapshot,
});
export type RecordedRun = z.infer<typeof RecordedRun>;

// Everyone a plan is about: the group's members, or the two people of a pair.
export function membersOfPlan(plan: Pick<Plan, "participants" | "group">): MemberId[] {
  return plan.group ? [...plan.group.members] : [...plan.participants];
}
