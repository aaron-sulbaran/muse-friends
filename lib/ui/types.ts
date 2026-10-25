/*
 * The shape the UI renders. lib/ui/snapshot.ts maps the Store's StateSnapshot
 * (lib/protocol.ts) onto it, so components never import the Store or the wire
 * schemas directly and a contract change lands in one adapter.
 */

import type { RunBudget } from "@/lib/agent/caps";
import type {
  AgentId,
  Category,
  Decision,
  MessageType,
  PlanState,
  Reason as MessageReason,
  Role,
  ShareTier,
  TaskState as ThreadState,
  Window as TimeWindow,
} from "@/lib/protocol";

// The wire vocabulary comes from the protocol, never a copy, so a new reason or
// category cannot silently break the adapter's types.
export type { AgentId, Category, Decision, MessageReason, MessageType, PlanState, Role, ShareTier, ThreadState, TimeWindow };

/** What a Muse is doing, for the header avatar's loop: nothing, reading or waiting on a model, or talking to the other Muse. */
export type AvatarMood = "idle" | "thinking" | "talking";

/** One tool a model call used: its name and a one-line summary of the arguments and of what came back. */
export type UiToolCall = { name: string; args: string; result: string };

export type ModelProof = {
  model: string;
  responseId: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  /** The tools this call used, when the store recorded them; absent otherwise. */
  toolCalls?: UiToolCall[];
};

export type UiMessage = {
  id: string;
  contextId: string;
  seq: number;
  from: AgentId;
  to: AgentId;
  type: MessageType;
  state: ThreadState;
  activity?: { title: string; place?: string };
  windows?: TimeWindow[];
  reason: MessageReason;
  note?: string;
  /** Categories that crossed to the receiver, after policy. */
  shared: Category[];
  /** Categories policy removed from this message. */
  removed: Category[];
  at: string;
  /** Present on messages a model call produced; absent on scripted fixtures. */
  proof?: ModelProof;
  /** Present when the receiving inbox rejected the message. */
  blockedRule?: string;
  /** The message as delivered, shown only in the JSON drawer. */
  raw: unknown;
};

export type UiPlan = {
  id: string;
  contextId: string;
  /** The agent that opened the thread; only its human gets the WhatsApp draft. */
  initiator: AgentId;
  state: PlanState;
  activityTitle: string;
  /** The contact this plan is a follow-up with, when the person named one instead of a reel arriving. */
  target: { id: string; name: string } | null;
  /** True when the start gate refused this follow-up: nothing started, and the phone and timeline say so. */
  refused: boolean;
  /** Where, when the caption or a message named a place that adds to the title and policy has not withheld it. */
  place: string | null;
  /** True once a redaction removed location from this plan's thread: the card says so instead of showing a place. */
  placeWithheld: boolean;
  window: TimeWindow | null;
  decisions: Record<Role, Decision>;
  draft: string | null;
  droppedReason: string | null;
  /** When each state was reached, oldest first. */
  history: Array<{ state: PlanState; at: string }>;
  /** What the people said about whether it happened; null until someone answers. */
  outcome: UiOutcome | null;
};

export type UiOutcome = { result: "went" | "didnt"; at: string; nextIdeaId: string | null; chosenBy: "model" | "rule" | null };

export type FollowThroughEvent = {
  id: string;
  label: string;
  at: string;
};

/** Someone Sprout could follow up with. The person picks; the code decides whether Sprout may reach out. */
export type UiContact = {
  id: string;
  name: string;
  tier: ShareTier;
  youFollow: boolean;
  followsYou: boolean;
  /** True when the two follow each other; Sprout only reaches out to people who do. */
  mutualFollow: boolean;
  /** One line on how they know each other. */
  note: string;
};

/** The start-path gate said no: nothing was started, and the timeline says so plainly. */
export type UiRefusal = { id: string; at: string; contactName: string; text: string };

/** A timeline row that is not a message: the reel's caption read, the thread opening, a sharing change. */
export type UiNote = {
  id: string;
  kind:
    | "caption_extracted"
    | "thread_opened"
    | "policy_changed"
    | "busy_added"
    | "message_rejected"
    | "reel_source"
    | "contact_chosen"
    | "contact_refused"
    | "payment_sent"
    | "payment_received"
    | "payment_declined"
    | "payment_failed"
    | "payment_proposed"
    | "payment_cancelled"
    | "receipt_read";
  at: string;
  text: string;
};

export type InFlight = {
  /** The agent whose model call is running. */
  agent: AgentId;
};

export type SharingSettings = {
  tier: ShareTier;
  categories: Record<Category, boolean>;
};

/** One seat's wallet. The balance is what the ledger last said; `source` says which ledger. */
export type UiWallet = {
  balance: number;
  nickname: string;
  source: "nessie" | "local";
  accountId: string;
};

/** One line of a payment's breakdown. The lines add up to the payment's amount; a deduction is negative. */
export type UiBreakdownLine = {
  label: string;
  amount: number;
  /** The raw source: a tool call id from the turn that prepared it, "note", or "estimate". */
  source: string;
  /** "tool" lines cite a call (the seeded receipt read, for example), "note" the person's words, "estimate" the Muse's own. */
  sourceKind: "tool" | "note" | "estimate";
  /** The name of the tool a "tool" source points at, when it is one of the tool calls on the payment. */
  tool?: string;
};

/**
 * One payment between the two Muses. proposed: the Muse prepared it and explained it, and nothing has moved until the
 * person confirms (D28); declined: the person said no; failed: the confirm did not go through and nothing moved (or it
 * was refunded); sent: confirmed, waiting on the friend's Muse; received: the friend's Muse kept it; refunded: the
 * friend's Muse sent it back.
 */
export type UiPayment = {
  id: string;
  planId: string;
  from: AgentId;
  to: AgentId;
  amount: number;
  reason: string;
  /** The reason with the plan's event and day in front ("Shawarma Point, Tue Oct 27, dinner share"); the cards show this when set. */
  description?: string;
  /** The plan it belonged to, named by its event and day ("Shawarma Point, Tue Oct 27"); unset when the plan is not known. */
  planLabel?: string;
  note?: string;
  status: "proposed" | "declined" | "failed" | "sent" | "received" | "refunded";
  source: "nessie" | "local";
  /** The sourced breakdown behind the amount, shown in the provenance drawer. */
  breakdown?: UiBreakdownLine[];
  /** The breakdown as a plain sentence built from the same lines, for "Why $16?". */
  explanation?: string;
  /** Set when the Muse read the seeded receipt: it is a labeled fixture, never a real receipt. */
  receipt?: { seeded: true; place: string; total: number };
  /** While proposed (or failed and retryable): POST { role } here to confirm or decline. */
  confirmUrl?: string;
  declineUrl?: string;
  /** Why a confirm did not go through, in words. */
  error?: string;
  withdrawalId?: string;
  /** The deposit into the receiver, or the refund deposit into the payer. */
  depositId?: string;
  /** The receiver's balance around the deposit, when it was kept. */
  balanceBefore?: number;
  balanceAfter?: number;
  /** The tools the payer's Muse called on the way to this payment (the same list as the proof on the message). */
  toolCalls?: UiToolCall[];
  at: string;
};

/** What a person lets their Muse do with money: off by default, with a cap per plan in whole dollars. */
export type PaymentsSettings = { enabled: boolean; cap: number };

/** The demo reel when it was read live from its owner's Instagram; null means the seeded, fictional reel. */
export type UiReel = { username: string; caption: string; permalink: string; thumbnailUrl: string | null };

/** Which recording a replay frame was built from, so the badge can say what is playing and from when. */
export type UiRecording = { source: "live" | "scripted"; recordedAt: string };

export type UiSnapshot = {
  /** The demo clock, ISO. */
  now: string;
  clockSimulated: boolean;
  mode: "live" | "replay";
  /** Only on replay frames: the recording they came from. */
  recording?: UiRecording;
  /** True when side b is played by the model instead of a second human. */
  simulatedFriend: boolean;
  /**
   * Who side b's person is when it is not the Muse's own persona: the simulated friend, or the contact the
   * person chose to follow up with. Their name replaces the persona's in sentences, and they get an initial disc.
   */
  standIn: { person: string; muse: string } | null;
  /** What people see for each side: the Muse characters' names, never the internal ids. */
  sides: Record<AgentId, string>;
  messages: UiMessage[];
  /** Non-message timeline rows, merged with the messages by time. */
  notes: UiNote[];
  /** Who the "follow up with someone you met" entry offers. */
  contacts: UiContact[];
  /** The latest time the gate refused to start, while no plan is running; null otherwise. */
  refusal: UiRefusal | null;
  plan: UiPlan | null;
  /** The demo reel read live from Instagram, or null for the seeded one. */
  reel: UiReel | null;
  followThrough: {
    /** Plans that happened: the only thing the counter counts. */
    events: FollowThroughEvent[];
    agentMessageCount: number;
    /** Taps and sends by people that move a plan along but are not the outcome. */
    humanTapCount: number;
  };
  inFlight: InFlight | null;
  /** The live-run caps right now; null while a recording is on screen, which spends nothing. */
  budget: RunBudget | null;
  /** Set when an agent's turn ended without a message: the thread stopped and the presenter decides on Replay. */
  failure: { agent: AgentId } | null;
  /** What each side currently lets the other see. */
  sharing: Record<AgentId, SharingSettings>;
  /** Each side's wallet; null until Reset has created it (or while payments are switched off). */
  wallets: Record<AgentId, UiWallet | null>;
  /** Payments between the Muses, oldest first. They are not in `messages`. */
  payments: UiPayment[];
  /** What each side lets its Muse send. */
  paymentsScope: Record<AgentId, PaymentsSettings>;
  /** `connected` is true only when the wallets live on the real Nessie sandbox; otherwise a local ledger stands in. */
  sandbox: {
    enabled: boolean;
    connected: boolean;
    text: string;
    /** Present only on the real sandbox, which keeps the transaction records but never moves an account's balance field (checked live); print it near the wallet chip. */
    balanceNote?: string;
  };
};
