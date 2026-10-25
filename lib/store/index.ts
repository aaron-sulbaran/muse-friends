import type {
  ActivityEvent,
  AgentId,
  DemoClock,
  MessageRecord,
  Plan,
  RecordedRun,
  Recommendation,
  Redaction,
  SharePolicy,
  Signal,
  StateSnapshot,
  Thread,
} from "@/lib/protocol";

// The seam between the lanes. Lane A writes the JSON implementation (lib/store/json.ts, local
// development) and Lane P writes the Supabase one (lib/store/supabase.ts, production), both
// against this interface. Lane B reads through `snapshot()` and never needs to know which.
//
// Writes are upserts keyed by id unless noted. `appendMessage`, `appendEvent`, `appendRedaction`
// and `addRejectedWindow` are append-only so two hops writing at once cannot clobber each other.
// List methods return oldest first.
export interface Store {
  // Threads, keyed by contextId.
  getThread(contextId: string): Promise<Thread | null>;
  putThread(thread: Thread): Promise<void>;
  listThreads(filter?: { agent?: AgentId }): Promise<Thread[]>;

  // Messages, ordered by contextId then seq. Appending the same (contextId, seq) twice is a no-op,
  // which keeps inbox retries idempotent.
  appendMessage(record: MessageRecord): Promise<void>;
  listMessages(contextId?: string): Promise<MessageRecord[]>;

  // Plans, keyed by id. One plan per thread.
  getPlan(id: string): Promise<Plan | null>;
  getPlanByContext(contextId: string): Promise<Plan | null>;
  putPlan(plan: Plan): Promise<void>;
  listPlans(): Promise<Plan[]>;

  // Recommendation cards, keyed by id; one per human per plan.
  putCard(card: Recommendation): Promise<void>;
  listCards(filter?: { planId?: string; forAgent?: AgentId }): Promise<Recommendation[]>;

  // Share policies, keyed by (owner, friend). A missing policy means tier "off".
  getPolicy(owner: AgentId, friend: AgentId): Promise<SharePolicy | null>;
  putPolicy(policy: SharePolicy): Promise<void>;
  listPolicies(): Promise<SharePolicy[]>;

  // Redactions logged by enforceSharePolicy; never contain the removed value.
  appendRedaction(redaction: Redaction): Promise<void>;
  listRedactions(contextId?: string): Promise<Redaction[]>;

  // Rejected-window ledger: hashes (see windowHash) of windows proposed and passed over in a thread.
  addRejectedWindow(contextId: string, hash: string): Promise<void>;
  listRejectedWindows(contextId: string): Promise<string[]>;

  // Seeded signals, keyed by id.
  putSignal(signal: Signal): Promise<void>;
  getSignal(id: string): Promise<Signal | null>;
  listSignals(): Promise<Signal[]>;

  // Activity timeline rows, in append order.
  appendEvent(event: ActivityEvent): Promise<void>;
  listEvents(filter?: { contextId?: string; planId?: string }): Promise<ActivityEvent[]>;

  // The demo clock the plan lifecycle runs on.
  getClock(): Promise<DemoClock>;
  setClock(clock: DemoClock): Promise<void>;

  // Recorded runs for Replay, keyed by id.
  saveRecordedRun(run: RecordedRun): Promise<void>;
  getRecordedRun(id: string): Promise<RecordedRun | null>;
  listRecordedRuns(): Promise<RecordedRun[]>;

  // Everything in one read, for /api/state and for recording a run.
  snapshot(): Promise<StateSnapshot>;
  // Wipe live state and load a snapshot (seed policies and clock, or a recorded run). Recorded
  // runs saved with saveRecordedRun survive a replace.
  replaceAll(snapshot: StateSnapshot): Promise<void>;
}
