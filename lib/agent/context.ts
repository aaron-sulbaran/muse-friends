import type { Store } from "@/lib/store";
import type { MemberId, MessageRecord, PlanGroup, Redaction } from "@/lib/protocol";

// What a tool handler needs to know about the turn it runs in.
export type DeliveryResult = { ok: true } | { ok: false; status: number; error: string };

// A message ready to go out: built, policy-checked, and stamped. Delivery commits it to the thread
// (locally, or by POSTing it to the friend's inbox, which validates and commits it there).
export type Outgoing = { record: MessageRecord; redaction: Redaction | null };

export type AgentRuntimeContext = {
  agent: MemberId;
  store: Store;
  // Wall clock in milliseconds; injectable for tests.
  wallNow?: () => number;
  // The signal this turn is about (the agent that received the reel).
  signalId?: string;
  // The contact a follow-up is for, chosen by the person. Like a signal, it is what lets a turn open a thread.
  target?: string;
  // Who this turn may message. Defaults to the other phone seat; a group turn lists its members, and the third
  // friend's turn lists the coordinator.
  counterparts?: MemberId[];
  // The pair thread to use for each counterpart, for a coordinator that talks to several friends in one turn.
  contexts?: Partial<Record<MemberId, string>>;
  // Set when the turn belongs to a group plan.
  group?: PlanGroup;
  // The thread this turn belongs to. For a signal turn it is assigned up front; the thread record
  // is created when the first message commits.
  contextId: string;
  deliver?: (outgoing: Outgoing) => Promise<DeliveryResult>;
  // Per-turn counters.
  windowRepairs: { used: number };
};
