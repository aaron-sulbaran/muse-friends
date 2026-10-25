import type {
  ActivityEvent,
  MemberId,
  BusyBlock,
  DemoClock,
  MessageRecord,
  Plan,
  RecordedRun,
  Recommendation,
  Redaction,
  Room,
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
  listThreads(filter?: { agent?: MemberId }): Promise<Thread[]>;

  // Messages, ordered by contextId then seq. Appending the same (contextId, seq) twice is a no-op,
  // which keeps inbox retries idempotent.
  appendMessage(record: MessageRecord): Promise<void>;
  listMessages(contextId?: string): Promise<MessageRecord[]>;
  // Rewrites an already stored message in place, matched on (contextId, seq). Used when a privacy
  // toggle replays a message under the new policy; the message keeps its id and position.
  replaceMessage(record: MessageRecord): Promise<void>;

  // Plans, keyed by id. One plan per thread.
  getPlan(id: string): Promise<Plan | null>;
  getPlanByContext(contextId: string): Promise<Plan | null>;
  putPlan(plan: Plan): Promise<void>;
  listPlans(): Promise<Plan[]>;

  // Recommendation cards, keyed by id; one per human per plan.
  putCard(card: Recommendation): Promise<void>;
  listCards(filter?: { planId?: string; forAgent?: MemberId }): Promise<Recommendation[]>;

  // Share policies, keyed by (owner, friend). A missing policy means tier "off".
  getPolicy(owner: MemberId, friend: MemberId): Promise<SharePolicy | null>;
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

  // The single demo room (id "demo"). Judges come one pair at a time; reset wipes live state.
  getRoom(): Promise<Room>;
  putRoom(room: Room): Promise<void>;

  // Busy blocks added from the controls, merged into the persona's calendar by get_my_calendar.
  addBusy(block: BusyBlock): Promise<void>;
  listBusy(agent?: MemberId): Promise<BusyBlock[]>;

  // The demo clock the plan lifecycle runs on.
  getClock(): Promise<DemoClock>;
  setClock(clock: DemoClock): Promise<void>;

  // Recorded runs for Replay, keyed by id.
  saveRecordedRun(run: RecordedRun): Promise<void>;
  getRecordedRun(id: string): Promise<RecordedRun | null>;
  listRecordedRuns(): Promise<RecordedRun[]>;

  // An opaque string that changes whenever any state changes, so /api/state can answer a
  // poll with 304 (ETag) without reading the whole snapshot.
  cursor(): Promise<string>;

  // Everything in one read, for /api/state and for recording a run.
  snapshot(): Promise<StateSnapshot>;
  // Wipe live state and load a snapshot (seed policies and clock, or a recorded run). Recorded
  // runs saved with saveRecordedRun survive a replace.
  replaceAll(snapshot: StateSnapshot): Promise<void>;
}

type StoreModule = { createStore: () => Store | Promise<Store> };

// One store per server process. STORE=supabase loads lib/store/supabase.ts (Lane P), which must
// export createStore(); anything else uses the local JSON file. Shared through globalThis so every
// route bundle in `next dev` sees the same instance.
export async function getStore(): Promise<Store> {
  const shared = globalThis as typeof globalThis & { __museStore?: Promise<Store> };
  shared.__museStore ??= (async () => {
    const name = process.env.STORE === "supabase" ? "supabase" : "json";
    const implementation = (await import(`./${name}`)) as StoreModule;
    return implementation.createStore();
  })();
  return shared.__museStore;
}
