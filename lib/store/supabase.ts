import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ActivityEvent,
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
import { DEFAULT_ROOM, DEMO_START } from "@/lib/seed/fixtures";
import type { Store } from "@/lib/store";

// The production Store. Every collection is a table of JSONB documents (supabase/migrations), read
// and written server-side with the service role key. The key never reaches the browser: this file
// is imported by route handlers only.

export class StoreError extends Error {
  constructor(operation: string, detail: string) {
    super(`supabase store ${operation} failed: ${detail}`);
    this.name = "StoreError";
  }
}

type Outcome<T> = { data: T | null; error: { message: string } | null };

function unwrap<T>(operation: string, outcome: Outcome<T>): T | null {
  if (outcome.error) throw new StoreError(operation, outcome.error.message);
  return outcome.data;
}

function documents<T>(operation: string, outcome: Outcome<{ data: T }[]>): T[] {
  return (unwrap(operation, outcome) ?? []).map((row) => row.data);
}

function document<T>(operation: string, outcome: Outcome<{ data: T }>): T | null {
  return unwrap(operation, outcome)?.data ?? null;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new StoreError("setup", `${name} is not set`);
  return value;
}

export type SupabaseStoreOptions = { client?: SupabaseClient };

export function createSupabaseStore(options: SupabaseStoreOptions = {}): Store {
  const db =
    options.client ??
    createClient(requiredEnvironment("SUPABASE_URL"), requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
      // A function instance can serve many requests; make sure no response is ever reused.
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    });

  const appendOnly = { ignoreDuplicates: true } as const;

  const store: Store = {
    async getThread(contextId) {
      return document<Thread>(
        "getThread",
        await db.from("threads").select("data").eq("context_id", contextId).maybeSingle(),
      );
    },
    async putThread(thread) {
      unwrap("putThread", await db.from("threads").upsert({ context_id: thread.contextId, data: thread }));
    },
    async listThreads(filter) {
      const threads = documents<Thread>("listThreads", await db.from("threads").select("data").order("ord"));
      const agent = filter?.agent;
      return agent ? threads.filter((thread) => thread.participants.includes(agent)) : threads;
    },

    async appendMessage(record) {
      unwrap(
        "appendMessage",
        await db
          .from("messages")
          .upsert(
            { context_id: record.message.contextId, seq: record.message.seq, data: record },
            { onConflict: "context_id,seq", ...appendOnly },
          ),
      );
    },
    async listMessages(contextId) {
      let query = db.from("messages").select("data");
      if (contextId) query = query.eq("context_id", contextId);
      return documents<MessageRecord>("listMessages", await query.order("context_id").order("seq"));
    },

    async getPlan(id) {
      return document<Plan>("getPlan", await db.from("plans").select("data").eq("id", id).maybeSingle());
    },
    async getPlanByContext(contextId) {
      return document<Plan>(
        "getPlanByContext",
        await db.from("plans").select("data").eq("context_id", contextId).maybeSingle(),
      );
    },
    async putPlan(plan) {
      unwrap("putPlan", await db.from("plans").upsert({ id: plan.id, context_id: plan.contextId, data: plan }));
    },
    async listPlans() {
      return documents<Plan>("listPlans", await db.from("plans").select("data").order("ord"));
    },

    async putCard(card) {
      unwrap(
        "putCard",
        await db.from("cards").upsert({ id: card.id, plan_id: card.planId, for_agent: card.forAgent, data: card }),
      );
    },
    async listCards(filter) {
      let query = db.from("cards").select("data");
      if (filter?.planId) query = query.eq("plan_id", filter.planId);
      if (filter?.forAgent) query = query.eq("for_agent", filter.forAgent);
      return documents<Recommendation>("listCards", await query.order("ord"));
    },

    async getPolicy(owner, friend) {
      return document<SharePolicy>(
        "getPolicy",
        await db.from("policies").select("data").eq("owner", owner).eq("friend", friend).maybeSingle(),
      );
    },
    async putPolicy(policy) {
      unwrap(
        "putPolicy",
        await db.from("policies").upsert({ owner: policy.owner, friend: policy.friend, data: policy }),
      );
    },
    async listPolicies() {
      return documents<SharePolicy>("listPolicies", await db.from("policies").select("data").order("ord"));
    },

    async appendRedaction(redaction) {
      unwrap(
        "appendRedaction",
        await db
          .from("redactions")
          .upsert({ id: redaction.id, context_id: redaction.contextId, data: redaction }, appendOnly),
      );
    },
    async listRedactions(contextId) {
      let query = db.from("redactions").select("data");
      if (contextId) query = query.eq("context_id", contextId);
      return documents<Redaction>("listRedactions", await query.order("ord"));
    },

    async addRejectedWindow(contextId, hash) {
      unwrap(
        "addRejectedWindow",
        await db
          .from("rejected_windows")
          .upsert({ context_id: contextId, hash }, { onConflict: "context_id,hash", ...appendOnly }),
      );
    },
    async listRejectedWindows(contextId) {
      const rows = unwrap(
        "listRejectedWindows",
        await db.from("rejected_windows").select("hash").eq("context_id", contextId).order("ord"),
      );
      return (rows ?? []).map((row) => row.hash as string);
    },

    async putSignal(signal) {
      unwrap("putSignal", await db.from("signals").upsert({ id: signal.id, data: signal }));
    },
    async getSignal(id) {
      return document<Signal>("getSignal", await db.from("signals").select("data").eq("id", id).maybeSingle());
    },
    async listSignals() {
      return documents<Signal>("listSignals", await db.from("signals").select("data").order("ord"));
    },

    async appendEvent(event) {
      unwrap(
        "appendEvent",
        await db
          .from("events")
          .upsert(
            { id: event.id, context_id: event.contextId ?? null, plan_id: event.planId ?? null, data: event },
            appendOnly,
          ),
      );
    },
    async listEvents(filter) {
      let query = db.from("events").select("data");
      if (filter?.contextId) query = query.eq("context_id", filter.contextId);
      if (filter?.planId) query = query.eq("plan_id", filter.planId);
      return documents<ActivityEvent>("listEvents", await query.order("ord"));
    },

    async getRoom() {
      return (
        document<Room>("getRoom", await db.from("room").select("data").eq("id", "demo").maybeSingle()) ?? DEFAULT_ROOM
      );
    },
    async putRoom(room) {
      unwrap("putRoom", await db.from("room").upsert({ id: room.id, data: room }));
    },

    async addBusy(block) {
      unwrap(
        "addBusy",
        await db.from("busy").upsert({ event_id: block.event.id, agent: block.agent, data: block }, appendOnly),
      );
    },
    async listBusy(agent) {
      let query = db.from("busy").select("data");
      if (agent) query = query.eq("agent", agent);
      return documents<BusyBlock>("listBusy", await query.order("ord"));
    },

    async getClock() {
      const stored = document<DemoClock>("getClock", await db.from("clock").select("data").eq("id", 1).maybeSingle());
      return stored ?? { now: DEMO_START };
    },
    async setClock(clock) {
      unwrap("setClock", await db.from("clock").upsert({ id: 1, data: clock }));
    },

    async saveRecordedRun(run) {
      unwrap("saveRecordedRun", await db.from("recorded_runs").upsert({ id: run.id, data: run }));
    },
    async getRecordedRun(id) {
      return document<RecordedRun>(
        "getRecordedRun",
        await db.from("recorded_runs").select("data").eq("id", id).maybeSingle(),
      );
    },
    async listRecordedRuns() {
      return documents<RecordedRun>("listRecordedRuns", await db.from("recorded_runs").select("data").order("ord"));
    },

    async cursor() {
      const row = unwrap<{ version: number | string }>("cursor", await db.from("cursor").select("version").eq("id", 1).maybeSingle());
      return String(row?.version ?? 0);
    },

    async snapshot() {
      const snapshot = unwrap("snapshot", await db.rpc("store_snapshot"));
      if (!snapshot) throw new StoreError("snapshot", "empty reply");
      const state = snapshot as StateSnapshot;
      return { ...state, room: state.room ?? DEFAULT_ROOM, clock: state.clock ?? { now: DEMO_START } };
    },
    async replaceAll(snapshot) {
      unwrap("replaceAll", await db.rpc("store_replace_all", { snapshot }));
    },
  };

  return store;
}
