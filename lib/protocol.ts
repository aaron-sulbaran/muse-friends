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

// The negotiation types are what a model authors through send_to_friend_agent. payment and payment_received
// belong to the payments channel: only the runtime writes them, after the wallet and the policy cap have been
// checked, never a model through the negotiation tool.
export const NEGOTIATION_TYPES = ["intent", "propose", "counter", "accept", "decline"] as const;
export const NegotiationType = z.enum(NEGOTIATION_TYPES);
// payment_cancelled: the payer's person declined a proposal, so the friend's Muse is told nothing moved.
export const PAYMENT_TYPES = ["payment", "payment_received", "payment_cancelled"] as const;
export const MESSAGE_TYPES = [...NEGOTIATION_TYPES, ...PAYMENT_TYPES] as const;
export const MessageType = z.enum(MESSAGE_TYPES);
export type MessageType = z.infer<typeof MessageType>;
export function isPaymentType(type: MessageType): type is (typeof PAYMENT_TYPES)[number] {
  return (PAYMENT_TYPES as readonly string[]).includes(type);
}

// A2A v0.3 task-state names, the subset this protocol uses.
export const TASK_STATES = ["working", "input-required", "completed", "rejected", "failed"] as const;
export const TaskState = z.enum(TASK_STATES);
export type TaskState = z.infer<typeof TaskState>;

export const REASONS = ["both_free", "interest_match", "no_overlap", "not_interested", "cap_reached", "settle_up"] as const;
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

// Payments (Capital One Nessie sandbox, or the local ledger when no key is set). Whole dollars only.
export const PAYMENT_MAX_DOLLARS = 500;
export const PaymentOutcome = z.enum(["accepted", "declined"]);
export type PaymentOutcome = z.infer<typeof PaymentOutcome>;

const DollarAmount = z.number().int().min(1).max(PAYMENT_MAX_DOLLARS);

// One line of the sourced breakdown behind a proposed payment: what it is, how many dollars (a deduction is
// negative), and where the number came from. `source` is the id of a tool call from the turn that wrote the
// proposal (for example the read_receipt call), the literal "note" (the person's note), or the literal "estimate".
export const BREAKDOWN_NOTE = "note";
export const BREAKDOWN_ESTIMATE = "estimate";
export const BreakdownLine = z.strictObject({
  label: z.string().min(1).max(60),
  amount: z.number().int().min(-PAYMENT_MAX_DOLLARS).max(PAYMENT_MAX_DOLLARS),
  source: z.string().min(1).max(64),
});
export type BreakdownLine = z.infer<typeof BreakdownLine>;
export const Breakdown = z.array(BreakdownLine).min(1).max(8);
export type Breakdown = z.infer<typeof Breakdown>;
export function breakdownSum(lines: Breakdown): number {
  return lines.reduce((total, line) => total + line.amount, 0);
}
const Balance = z.number().int().min(-10_000).max(1_000_000);

// What a payment message carries. The first message (payment) says what left the payer's account; the answer
// (payment_received) says what the receiver did with it: kept it (deposit, new balance) or sent it back (refund).
export const Payment = z.strictObject({
  paymentId: Id,
  planId: Id,
  amount: DollarAmount,
  currency: z.literal("USD"),
  // What it is for, in the sender's words. Scanned like a note: private details never travel.
  reason: z.string().min(1).max(100),
  // Which ledger moved the money: the Nessie sandbox, or the in-app local ledger when no key is set.
  source: z.enum(["nessie", "local"]),
  payerAccountId: Id,
  withdrawalId: Id.optional(),
  outcome: PaymentOutcome.optional(),
  payeeAccountId: Id.optional(),
  // accepted: the deposit into the receiver's account. declined: the refund deposit back into the payer's.
  depositId: Id.optional(),
  balanceBefore: Balance.optional(),
  balanceAfter: Balance.optional(),
  // How the payer's Muse worked the amount out; on payment (and payment_cancelled), and the lines add up to the amount.
  breakdown: Breakdown.optional(),
});
export type Payment = z.infer<typeof Payment>;

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
    case "payment":
    case "payment_received":
    case "payment_cancelled":
      if (count > 0) issue("a payment carries no windows");
      return;
  }
}

// A payment message carries a payment, and only a payment message does.
function checkPaymentShape(value: { type: MessageType; payment?: Payment }, ctx: z.RefinementCtx) {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message, path: ["payment"] });
  const payment = value.payment;
  if (!isPaymentType(value.type)) {
    if (payment) issue("only a payment message carries a payment");
    return;
  }
  if (!payment) return issue(`${value.type} needs a payment`);
  if (payment.breakdown && breakdownSum(payment.breakdown) !== payment.amount) issue("the breakdown lines must add up to the amount");
  if (value.type === "payment") {
    if (!payment.withdrawalId) issue("payment needs the withdrawalId");
    if (payment.outcome || payment.depositId) issue("payment cannot carry an outcome");
    return;
  }
  if (value.type === "payment_cancelled") {
    if (payment.withdrawalId || payment.outcome || payment.depositId) issue("a cancelled payment moved no money, so it carries no ids or outcome");
    return;
  }
  if (!payment.outcome) return issue("payment_received needs an outcome");
  if (!payment.depositId) issue("payment_received needs the depositId (or the refund id)");
  if (payment.outcome === "accepted" && (payment.payeeAccountId === undefined || payment.balanceBefore === undefined || payment.balanceAfter === undefined)) {
    issue("an accepted payment needs the payee account and the balance before and after");
  }
}

export const AgentMessage = z
  .strictObject({
    id: Id,
    contextId: Id,
    seq: z.number().int().min(1).max(THREAD_CAP),
    from: AgentId,
    to: AgentId,
    type: MessageType,
    state: TaskState,
    activity: Activity.optional(),
    windows: z.array(Window).max(MAX_WINDOWS).optional(),
    reason: Reason,
    note: z.string().max(NOTE_MAX).optional(),
    shared: Shared.optional(),
    payment: Payment.optional(),
    at: IsoDateTime,
  })
  .superRefine((message, ctx) => {
    if (message.from === message.to) {
      ctx.addIssue({ code: "custom", message: "from and to must differ", path: ["to"] });
    }
    checkWindowRules(message, ctx);
    checkPaymentShape(message, ctx);
  });
export type AgentMessage = z.infer<typeof AgentMessage>;

// What the model authors through `send_to_friend_agent`. The runtime fills id, contextId, seq,
// from, to, state, at, and builds `shared` from `share` through the sender's allowlist, so a
// model can never forge identity, position, or state.
const MessageDraftShape = z.strictObject({
  type: NegotiationType.describe("intent opens, propose offers windows, counter answers with other windows, accept agrees to ONE window, decline ends it"),
  reason: Reason.describe("both_free: checked and it works; interest_match: shared interest; no_overlap: nothing fits; not_interested; cap_reached: out of messages"),
  activity: Activity.optional().describe("What the plan is, for example kind food, title Shawarma Point"),
  windows: z.array(Window).max(MAX_WINDOWS).optional().describe("Up to 3 windows copied exactly from your free blocks"),
  note: z.string().max(NOTE_MAX).optional().describe("One friendly sentence, max 140 characters, no private details"),
  share: z.array(SharedCategory).max(SHARED_CATEGORIES.length).optional().describe("Categories of your interests to share, if your person allows it"),
});

export const MessageDraft = MessageDraftShape.superRefine(checkWindowRules);
export type MessageDraft = z.infer<typeof MessageDraft>;

export const SendToFriendArgs = MessageDraftShape.extend({
  friend: AgentId.describe('The friend\'s agent id, exactly "aaron" or "lisa" (not a display name)'),
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

// The payments scope of a sharing policy: whether the owner's Muse may send money to this friend, and how much
// per plan. Off unless the person turns it on; it is not one of the content categories and no tier turns it on.
export const PaymentsScope = z.strictObject({
  enabled: z.boolean(),
  capPerPlan: z.number().int().min(0).max(PAYMENT_MAX_DOLLARS),
});
export type PaymentsScope = z.infer<typeof PaymentsScope>;

// `owner` is whose policy this is; `friend` is who it governs. A new friend defaults to tier "off".
export const SharePolicy = z
  .strictObject({
    owner: AgentId,
    friend: AgentId,
    tier: ShareTier,
    categories: z.partialRecord(Category, z.boolean()),
    payments: PaymentsScope.optional(),
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
  from: AgentId,
  to: AgentId,
  removed: z.array(Category).min(1),
  detail: z.string().max(160),
  at: IsoDateTime,
});
export type Redaction = z.infer<typeof Redaction>;

// Evidence that a model call produced the message: shown on the Activity row so a judge can see the
// agent link is live. Absent on scripted fixtures, which no model wrote.
// One tool the agent called on the way to this message, as one line of arguments and one line of result. Counts and
// the shape of the call only: never calendar titles, caption text, balances, or notes.
export const ToolCallProof = z.strictObject({
  name: z.string().min(1).max(40),
  args: z.string().max(100),
  result: z.string().max(100),
});
export type ToolCallProof = z.infer<typeof ToolCallProof>;

export const ModelProof = z.strictObject({
  model: z.string().max(40),
  responseId: z.string().max(80),
  latencyMs: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  reasoningTokens: z.number().int().min(0),
  // The tools the agent called this turn, in order, ending with the call that wrote this message.
  toolCalls: z.array(ToolCallProof).max(10).optional(),
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
  initiator: AgentId,
  participants: z.tuple([AgentId, AgentId]),
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

export const Plan = z.strictObject({
  id: Id,
  contextId: Id,
  initiator: AgentId,
  participants: z.tuple([AgentId, AgentId]),
  state: PlanState,
  activity: Activity.optional(),
  window: Window.optional(),
  decisions: z.record(AgentId, Decision),
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
  forAgent: AgentId,
  friend: AgentId,
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
  id: AgentId,
  role: Role,
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
  "payment_sent",
  "payment_received",
  "payment_declined",
  "payment_failed",
  "payment_proposed",
  "payment_cancelled",
  "receipt_read",
  "chat_asked",
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
  agent: AgentId.optional(),
  contextId: Id.optional(),
  planId: Id.optional(),
  messageId: Id.optional(),
  redactionId: Id.optional(),
  text: z.string().min(1).max(240),
});
export type ActivityEvent = z.infer<typeof ActivityEvent>;

// One line of the conversation between a person and their own Muse (D31). The person's question and the Muse's
// answer; the answer carries the proof of the model call that wrote it and the read tools it used. Side a only.
export const CHAT_QUESTION_MAX = 500;
export const CHAT_KEPT = 40;
export const ChatEntry = z.strictObject({
  id: Id,
  from: z.enum(["user", "muse"]),
  text: z.string().min(1).max(1500),
  at: IsoDateTime,
  // On a Muse answer: the question it answers.
  replyTo: Id.optional(),
  proof: ModelProof.optional(),
});
export type ChatEntry = z.infer<typeof ChatEntry>;

// The simulated "now" used by the plan lifecycle (reminder, happened, follow-up).
export const DemoClock = z.strictObject({ now: IsoDateTime });
export type DemoClock = z.infer<typeof DemoClock>;

// A payment the Muse has prepared and explained and the person has not yet confirmed. Nothing has moved: no
// withdrawal, no message to the friend. The person confirms (money moves) or declines (nothing does). It lives on
// the room until then; once confirmed, the payment message and the ledger take over as the record.
export const PROPOSAL_STATUSES = ["proposed", "confirming", "confirmed", "declined", "failed"] as const;
export const PaymentProposal = z
  .strictObject({
    paymentId: Id,
    planId: Id,
    payer: AgentId,
    payee: AgentId,
    amount: DollarAmount,
    reason: z.string().min(1).max(100),
    note: z.string().max(NOTE_MAX).optional(),
    breakdown: Breakdown,
    // The tool calls the turn had finished when it wrote the proposal: what each source id in the breakdown points at.
    calls: z.array(z.strictObject({ callId: z.string().min(1).max(64), name: z.string().min(1).max(40) })).max(10).optional(),
    // The seeded receipt the breakdown was read from, when the Muse read one this turn.
    receipt: z.strictObject({ id: Id, place: z.string().max(80), seeded: z.literal(true), total: DollarAmount }).optional(),
    source: z.enum(["nessie", "local"]),
    status: z.enum(PROPOSAL_STATUSES),
    // Why a confirm did not go through ("Payment failed, sandbox error: ...").
    error: z.string().max(200).optional(),
    // The model call that wrote the proposal, with the tools it called; it rides on the payment message when sent.
    proof: ModelProof.optional(),
    proposedAt: IsoDateTime,
    decidedAt: IsoDateTime.optional(),
  })
  .superRefine((proposal, ctx) => {
    if (breakdownSum(proposal.breakdown) !== proposal.amount) ctx.addIssue({ code: "custom", message: "the breakdown lines must add up to the amount", path: ["breakdown"] });
  });
export type PaymentProposal = z.infer<typeof PaymentProposal>;

// A seat's wallet. The balance is the last one read back from the ledger, never computed here.
export const Wallet = z.strictObject({
  owner: AgentId,
  customerId: Id,
  accountId: Id,
  nickname: z.string().min(1).max(60),
  balance: z.number().int(),
  startingBalance: z.number().int(),
  source: z.enum(["nessie", "local"]),
  updatedAt: IsoDateTime,
});
export type Wallet = z.infer<typeof Wallet>;

// The single demo room. `simulatedFriend` means side b is played by a model (Michelle) because
// only one judge is present; the UI must label it.
export const Room = z.strictObject({
  id: z.literal("demo"),
  simulatedFriend: z.boolean(),
  resetCount: z.number().int().min(0),
  // Each seat's wallet: a Nessie sandbox checking account, or a local-ledger account when no key is set.
  wallets: z.partialRecord(AgentId, Wallet).optional(),
  // The local ledger (account id to balance), used only while wallets are local. Never shown to the UI.
  localLedger: z.record(z.string(), z.number().int()).optional(),
  // Payments prepared and waiting for the person to confirm (or decided), by payment id.
  proposals: z.record(z.string(), PaymentProposal).optional(),
  // The chat with side a's own Muse (D31), oldest first, the last CHAT_KEPT lines. Cleared by Reset.
  chat: z.array(ChatEntry).max(CHAT_KEPT).optional(),
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
