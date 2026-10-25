import type { Store } from "@/lib/store";
import type { AgentId, MessageRecord, Redaction } from "@/lib/protocol";

// What a tool handler needs to know about the turn it runs in.
export type DeliveryResult = { ok: true } | { ok: false; status: number; error: string };

// A message ready to go out: built, policy-checked, and stamped. Delivery commits it to the thread
// (locally, or by POSTing it to the friend's inbox, which validates and commits it there).
export type Outgoing = { record: MessageRecord; redaction: Redaction | null };

export type AgentRuntimeContext = {
  agent: AgentId;
  store: Store;
  // Wall clock in milliseconds; injectable for tests.
  wallNow?: () => number;
  // The signal this turn is about (the agent that received the reel).
  signalId?: string;
  // The thread this turn belongs to. For a signal turn it is assigned up front; the thread record
  // is created when the first message commits.
  contextId: string;
  deliver?: (outgoing: Outgoing) => Promise<DeliveryResult>;
  // Per-turn counters.
  windowRepairs: { used: number };
};
