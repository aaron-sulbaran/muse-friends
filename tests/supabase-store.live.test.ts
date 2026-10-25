import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { StateSnapshot } from "@/lib/protocol";
import { recordedSnapshot, seedSnapshot, shawarmaRun } from "@/lib/seed/fixtures";
import { getStore } from "@/lib/store";
import { createSupabaseStore } from "@/lib/store/supabase";

// Round trip against the real project. Opt in with:
//   SUPABASE_LIVE_TEST=1 pnpm test tests/supabase-store.live.test.ts
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are read from .env. It writes only rows whose ids
// end in a per-run suffix and deletes them afterwards, so live demo state is never touched.
// store.replaceAll wipes live state, so it is exercised only with SUPABASE_LIVE_TEST_ALLOW_WIPE=1.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file; the variables may already be in the environment.
}

const live = process.env.SUPABASE_LIVE_TEST === "1" && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY;
const allowWipe = process.env.SUPABASE_LIVE_TEST_ALLOW_WIPE === "1";

const runId = `__t${Date.now().toString(36)}`;
const idKeys = new Set(["id", "contextId", "planId", "messageId", "redactionId", "signalId"]);

function suffixIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(suffixIds);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        idKeys.has(key) && typeof inner === "string" ? `${inner}${runId}` : suffixIds(inner),
      ]),
    );
  }
  return value;
}

const timings: Array<{ call: string; ms: number }> = [];
async function timed<T>(call: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await work();
  timings.push({ call, ms: Math.round(performance.now() - started) });
  return result;
}

describe.skipIf(!live)("supabase store against the real project", () => {
  const store = live ? createSupabaseStore() : null!;
  const admin = live
    ? createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null!;
  const base = recordedSnapshot();
  const source = {
    ...(suffixIds(base) as ReturnType<typeof recordedSnapshot>),
    // The ledger is keyed by contextId, so its keys carry the run suffix too.
    rejectedWindows: Object.fromEntries(Object.entries(base.rejectedWindows).map(([contextId, hashes]) => [`${contextId}${runId}`, hashes])),
  };
  const thread = source.threads[0];

  async function cleanup() {
    const like = `%${runId}`;
    await Promise.all([
      admin.from("threads").delete().like("context_id", like),
      admin.from("messages").delete().like("context_id", like),
      admin.from("plans").delete().like("id", like),
      admin.from("cards").delete().like("id", like),
      admin.from("redactions").delete().like("id", like),
      admin.from("rejected_windows").delete().like("context_id", like),
      admin.from("signals").delete().like("id", like),
      admin.from("events").delete().like("id", like),
      admin.from("recorded_runs").delete().like("id", like),
      admin.from("busy").delete().like("event_id", like),
    ]);
  }

  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    const byCall = new Map<string, number[]>();
    for (const { call, ms } of timings) byCall.set(call, [...(byCall.get(call) ?? []), ms]);
    const summary = [...byCall.entries()].map(([call, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return { call, count: values.length, medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted[sorted.length - 1] };
    });
    const all = timings.map((entry) => entry.ms).sort((a, b) => a - b);
    process.stdout.write(
      `\nsupabase store latency per call (ms), run ${runId}, ${all.length} calls, median ${all[Math.floor(all.length / 2)]}, p95 ${all[Math.floor(all.length * 0.95)]}, max ${all[all.length - 1]}\n` +
        summary.map((row) => `  ${row.call.padEnd(34)} n=${String(row.count).padEnd(3)} median=${String(row.medianMs).padEnd(4)} max=${row.maxMs}`).join("\n") +
        "\n",
    );
  });

  it("starts seeded: a room, a clock, and the default policies, whether or not anyone ran a reset", async () => {
    expect((await timed("getRoom (first call seeds)", () => store.getRoom())).id).toBe("demo");
    expect((await timed("listPolicies", () => store.listPolicies())).length).toBeGreaterThanOrEqual(2);
    expect(await timed("getPolicy", () => store.getPolicy("lisa", "aaron"))).toMatchObject({ owner: "lisa", friend: "aaron" });
  });

  it("is what getStore returns when STORE=supabase", async () => {
    const shared = globalThis as typeof globalThis & { __museStore?: unknown };
    const previous = shared.__museStore;
    vi.stubEnv("STORE", "supabase");
    delete shared.__museStore;
    try {
      const viaFactory = await getStore();
      expect((await timed("getRoom via getStore", () => viaFactory.getRoom())).id).toBe("demo");
    } finally {
      vi.unstubAllEnvs();
      shared.__museStore = previous;
    }
  });

  it("round trips a thread, its messages, plan, cards, and events", async () => {
    await timed("putThread", () => store.putThread(thread));
    expect(await timed("getThread", () => store.getThread(thread.contextId))).toEqual(thread);
    const listed = await timed("listThreads", () => store.listThreads({ agent: thread.initiator }));
    expect(listed.map((item) => item.contextId)).toContain(thread.contextId);

    for (const record of source.messages) await timed("appendMessage", () => store.appendMessage(record));
    await timed("appendMessage (duplicate)", () => store.appendMessage(source.messages[0]));
    const messages = await timed("listMessages", () => store.listMessages(thread.contextId));
    expect(messages).toEqual(source.messages);

    // A privacy toggle replays a message in place: same id and position, new stamp.
    const replayed = { ...source.messages[1], stamp: { ...source.messages[1].stamp, removed: ["location" as const], passed: [] } };
    await timed("replaceMessage", () => store.replaceMessage(replayed));
    const afterReplace = await store.listMessages(thread.contextId);
    expect(afterReplace).toHaveLength(source.messages.length);
    expect(afterReplace[1]).toEqual(replayed);

    const plan = source.plans[0];
    await timed("putPlan", () => store.putPlan(plan));
    expect(await timed("getPlan", () => store.getPlan(plan.id))).toEqual(plan);
    expect(await timed("getPlanByContext", () => store.getPlanByContext(plan.contextId))).toEqual(plan);

    for (const card of source.cards) await timed("putCard", () => store.putCard(card));
    const cards = await timed("listCards", () => store.listCards({ planId: plan.id }));
    expect(cards).toEqual(source.cards);

    for (const event of source.events) await timed("appendEvent", () => store.appendEvent(event));
    await timed("appendEvent (duplicate)", () => store.appendEvent(source.events[0]));
    const events = await timed("listEvents", () => store.listEvents({ planId: plan.id }));
    expect(events.map((event) => event.id)).toEqual(source.events.filter((event) => event.planId === plan.id).map((event) => event.id));
  });

  it("keeps the rejected-window ledger free of duplicates", async () => {
    const hashes = source.rejectedWindows[thread.contextId];
    for (const hash of hashes) await timed("addRejectedWindow", () => store.addRejectedWindow(thread.contextId, hash));
    await timed("addRejectedWindow (duplicate)", () => store.addRejectedWindow(thread.contextId, hashes[0]));
    expect(await timed("listRejectedWindows", () => store.listRejectedWindows(thread.contextId))).toEqual(hashes);
  });

  it("round trips signals and recorded runs", async () => {
    const signal = source.signals[0];
    await timed("putSignal", () => store.putSignal(signal));
    expect(await timed("getSignal", () => store.getSignal(signal.id))).toEqual(signal);

    const run = suffixIds(shawarmaRun()) as ReturnType<typeof shawarmaRun>;
    await timed("saveRecordedRun", () => store.saveRecordedRun(run));
    expect(await timed("getRecordedRun", () => store.getRecordedRun(run.id))).toEqual(run);
    const runs = await timed("listRecordedRuns", () => store.listRecordedRuns());
    expect(runs.map((item) => item.id)).toContain(run.id);
  });

  it("keeps busy blocks per agent and moves the cursor on every write", async () => {
    const before = await timed("cursor", () => store.cursor());
    const block = {
      agent: "aaron" as const,
      event: {
        id: `busy_test${runId}`,
        title: "Test block",
        start: "2026-10-27T18:00:00-05:00",
        end: "2026-10-27T19:00:00-05:00",
        private: true,
      },
    };
    await timed("addBusy", () => store.addBusy(block));
    await timed("addBusy (duplicate)", () => store.addBusy(block));
    const own = await timed("listBusy", () => store.listBusy("aaron"));
    expect(own.filter((item) => item.event.id === block.event.id)).toEqual([block]);
    const others = await store.listBusy("lisa");
    expect(others.map((item) => item.event.id)).not.toContain(block.event.id);
    expect(await store.cursor()).not.toBe(before);
  });

  it("reads the room and the clock and returns a snapshot that parses and contains the test thread", async () => {
    expect((await timed("getRoom", () => store.getRoom())).id).toBe("demo");
    expect(Date.parse((await timed("getClock", () => store.getClock())).now)).not.toBeNaN();
    const snapshot = await timed("snapshot", () => store.snapshot());
    expect(StateSnapshot.safeParse(snapshot).success).toBe(true);
    expect(snapshot.threads.map((item) => item.contextId)).toContain(thread.contextId);
    expect(snapshot.rejectedWindows[thread.contextId]).toEqual(source.rejectedWindows[thread.contextId]);
  });

  it.skipIf(!allowWipe)("replaces everything from a snapshot, keeps recorded runs, and restores the seed", async () => {
    const before = await store.listRecordedRuns();
    const recorded = recordedSnapshot();
    try {
      await timed("replaceAll", () => store.replaceAll(recorded));
      const after = await timed("snapshot (after replaceAll)", () => store.snapshot());
      expect(after.threads).toEqual(recorded.threads);
      expect(after.messages).toEqual(recorded.messages);
      expect(after.rejectedWindows).toEqual(recorded.rejectedWindows);
      expect((await store.listRecordedRuns()).length).toBe(before.length);
    } finally {
      await timed("replaceAll (restore seed)", () => store.replaceAll(seedSnapshot()));
    }
    const restored = await store.snapshot();
    expect(restored.threads).toEqual([]);
    expect(restored.policies).toEqual(seedSnapshot().policies);
  });
});
