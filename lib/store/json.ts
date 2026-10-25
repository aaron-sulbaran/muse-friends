import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  RecordedRun,
  StateSnapshot,
  type ActivityEvent,
  type AgentId,
  type BusyBlock,
  type DemoClock,
  type MessageRecord,
  type Plan,
  type Recommendation,
  type Redaction,
  type Room,
  type SharePolicy,
  type Signal,
  type Thread,
} from "@/lib/protocol";
import { seedSnapshot } from "@/lib/seed/fixtures";
import type { Store } from "./index";

// Local development store: everything in memory, mirrored to data/store.json after each write.
// Vercel cannot write to disk, so production uses the Supabase implementation instead.

type Persisted = { snapshot: StateSnapshot; recordedRuns: Record<string, RecordedRun> };

export function defaultStorePath(): string {
  return process.env.STORE_PATH ?? path.join(process.cwd(), "data", "store.json");
}

function loadPersisted(file: string | null): Persisted {
  const fresh: Persisted = { snapshot: seedSnapshot(), recordedRuns: {} };
  if (!file) return fresh;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { snapshot?: unknown; recordedRuns?: Record<string, unknown> };
    const snapshot = StateSnapshot.parse(raw.snapshot);
    const recordedRuns: Record<string, RecordedRun> = {};
    for (const [id, run] of Object.entries(raw.recordedRuns ?? {})) recordedRuns[id] = RecordedRun.parse(run);
    return { snapshot, recordedRuns };
  } catch (error) {
    // A missing file is the normal first start; a corrupt one is set aside, not overwritten.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      try {
        renameSync(file, `${file}.corrupt-${Date.now()}`);
      } catch {
        // Nothing more to do; start fresh.
      }
    }
    return fresh;
  }
}

export class JsonStore implements Store {
  private state: Persisted;
  private version = 0;
  private readonly bootId = Math.random().toString(36).slice(2, 8);

  // Pass null for a purely in-memory store (tests).
  constructor(private readonly file: string | null = defaultStorePath()) {
    this.state = loadPersisted(file);
  }

  private commit(): void {
    this.version += 1;
    if (!this.file) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.state));
    renameSync(temp, this.file);
  }

  private get snap(): StateSnapshot {
    return this.state.snapshot;
  }

  private upsert<T>(list: T[], item: T, same: (existing: T) => boolean): void {
    const index = list.findIndex(same);
    if (index === -1) list.push(structuredClone(item));
    else list[index] = structuredClone(item);
    this.commit();
  }

  async getThread(contextId: string) {
    return structuredClone(this.snap.threads.find((thread) => thread.contextId === contextId) ?? null);
  }
  async putThread(thread: Thread) {
    this.upsert(this.snap.threads, thread, (existing) => existing.contextId === thread.contextId);
  }
  async listThreads(filter?: { agent?: AgentId }) {
    const threads = filter?.agent ? this.snap.threads.filter((thread) => thread.participants.includes(filter.agent!)) : this.snap.threads;
    return structuredClone(threads);
  }

  async appendMessage(record: MessageRecord) {
    const { contextId, seq } = record.message;
    if (this.snap.messages.some((existing) => existing.message.contextId === contextId && existing.message.seq === seq)) return;
    this.snap.messages.push(structuredClone(record));
    this.commit();
  }
  async listMessages(contextId?: string) {
    const messages = contextId ? this.snap.messages.filter((record) => record.message.contextId === contextId) : this.snap.messages;
    return structuredClone(
      [...messages].sort((a, b) => a.message.contextId.localeCompare(b.message.contextId) || a.message.seq - b.message.seq),
    );
  }

  async getPlan(id: string) {
    return structuredClone(this.snap.plans.find((plan) => plan.id === id) ?? null);
  }
  async getPlanByContext(contextId: string) {
    return structuredClone(this.snap.plans.find((plan) => plan.contextId === contextId) ?? null);
  }
  async putPlan(plan: Plan) {
    this.upsert(this.snap.plans, plan, (existing) => existing.id === plan.id);
  }
  async listPlans() {
    return structuredClone(this.snap.plans);
  }

  async putCard(card: Recommendation) {
    this.upsert(this.snap.cards, card, (existing) => existing.id === card.id);
  }
  async listCards(filter?: { planId?: string; forAgent?: AgentId }) {
    return structuredClone(
      this.snap.cards.filter((card) => (!filter?.planId || card.planId === filter.planId) && (!filter?.forAgent || card.forAgent === filter.forAgent)),
    );
  }

  async getPolicy(owner: AgentId, friend: AgentId) {
    return structuredClone(this.snap.policies.find((policy) => policy.owner === owner && policy.friend === friend) ?? null);
  }
  async putPolicy(policy: SharePolicy) {
    this.upsert(this.snap.policies, policy, (existing) => existing.owner === policy.owner && existing.friend === policy.friend);
  }
  async listPolicies() {
    return structuredClone(this.snap.policies);
  }

  async appendRedaction(redaction: Redaction) {
    this.upsert(this.snap.redactions, redaction, (existing) => existing.id === redaction.id);
  }
  async listRedactions(contextId?: string) {
    return structuredClone(contextId ? this.snap.redactions.filter((redaction) => redaction.contextId === contextId) : this.snap.redactions);
  }

  async addRejectedWindow(contextId: string, hash: string) {
    const ledger = (this.snap.rejectedWindows[contextId] ??= []);
    if (ledger.includes(hash)) return;
    ledger.push(hash);
    this.commit();
  }
  async listRejectedWindows(contextId: string) {
    return [...(this.snap.rejectedWindows[contextId] ?? [])];
  }

  async putSignal(signal: Signal) {
    this.upsert(this.snap.signals, signal, (existing) => existing.id === signal.id);
  }
  async getSignal(id: string) {
    return structuredClone(this.snap.signals.find((signal) => signal.id === id) ?? null);
  }
  async listSignals() {
    return structuredClone(this.snap.signals);
  }

  async appendEvent(event: ActivityEvent) {
    this.upsert(this.snap.events, event, (existing) => existing.id === event.id);
  }
  async listEvents(filter?: { contextId?: string; planId?: string }) {
    return structuredClone(
      this.snap.events.filter((event) => (!filter?.contextId || event.contextId === filter.contextId) && (!filter?.planId || event.planId === filter.planId)),
    );
  }

  async getRoom() {
    return structuredClone(this.snap.room);
  }
  async putRoom(room: Room) {
    this.snap.room = structuredClone(room);
    this.commit();
  }

  async addBusy(block: BusyBlock) {
    this.upsert(this.snap.busy, block, (existing) => existing.event.id === block.event.id);
  }
  async listBusy(agent?: AgentId) {
    return structuredClone(agent ? this.snap.busy.filter((block) => block.agent === agent) : this.snap.busy);
  }

  async getClock() {
    return structuredClone(this.snap.clock);
  }
  async setClock(clock: DemoClock) {
    this.snap.clock = structuredClone(clock);
    this.commit();
  }

  async saveRecordedRun(run: RecordedRun) {
    this.state.recordedRuns[run.id] = structuredClone(run);
    this.commit();
  }
  async getRecordedRun(id: string) {
    return structuredClone(this.state.recordedRuns[id] ?? null);
  }
  async listRecordedRuns() {
    return structuredClone(Object.values(this.state.recordedRuns));
  }

  async cursor() {
    return `${this.bootId}:${this.version}`;
  }
  async snapshot() {
    return structuredClone(this.snap);
  }
  async replaceAll(snapshot: StateSnapshot) {
    this.state.snapshot = structuredClone(StateSnapshot.parse(snapshot));
    this.commit();
  }
}

export function createStore(): Store {
  return new JsonStore();
}
