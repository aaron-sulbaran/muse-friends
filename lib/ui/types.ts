/*
 * The shape the UI renders. lib/ui/snapshot.ts maps the Store's StateSnapshot
 * (lib/protocol.ts) onto it, so components never import the Store or the wire
 * schemas directly and a contract change lands in one adapter.
 */

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

export type ModelProof = {
  model: string;
  responseId: string;
  latencyMs: number;
  totalTokens: number;
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
  /** True when this message id was already shown earlier: the same message sent again after a policy change. */
  replayed: boolean;
  /** Present on messages produced by a model call; absent on scripted or replayed ones. */
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
  /** Null when the place was withheld by policy. */
  place: string | null;
  window: TimeWindow | null;
  decisions: Record<Role, Decision>;
  draft: string | null;
  droppedReason: string | null;
  /** When each state was reached, oldest first. */
  history: Array<{ state: PlanState; at: string }>;
};

export type FollowThroughEvent = {
  id: string;
  label: string;
  at: string;
};

export type InFlight = {
  /** The agent whose model call is running. */
  agent: AgentId;
};

export type SharingSettings = {
  tier: ShareTier;
  categories: Record<Category, boolean>;
};

export type UiSnapshot = {
  /** The demo clock, ISO. */
  now: string;
  clockSimulated: boolean;
  mode: "live" | "replay";
  /** True when side b is played by the model instead of a second human. */
  simulatedFriend: boolean;
  /** What people see for each side: the Muse characters' names, never the internal ids. */
  sides: Record<AgentId, string>;
  messages: UiMessage[];
  plan: UiPlan | null;
  followThrough: {
    /** Plans that happened: the only thing the counter counts. */
    events: FollowThroughEvent[];
    agentMessageCount: number;
    /** Taps and sends by people that move a plan along but are not the outcome. */
    humanTapCount: number;
  };
  inFlight: InFlight | null;
  /** What each side currently lets the other see. */
  sharing: Record<AgentId, SharingSettings>;
};
