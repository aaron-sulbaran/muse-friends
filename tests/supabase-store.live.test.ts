import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StateSnapshot } from "@/lib/protocol";
import { recordedSnapshot, shawarmaRun } from "@/lib/seed/fixtures";
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
  const source = suffixIds(recordedSnapshot()) as ReturnType<typeof recordedSnapshot>;
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
    ]);
  }

  beforeAll(cleanup);
  afterAll(async () => {
    await cleanup();
    console.log(`supabase store latency per call (ms), run ${runId}`);
    console.table(timings);
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

  it("reads the clock and returns a snapshot that parses and contains the test thread", async () => {
    expect(Date.parse((await timed("getClock", () => store.getClock())).now)).not.toBeNaN();
    const snapshot = await timed("snapshot", () => store.snapshot());
    expect(StateSnapshot.safeParse(snapshot).success).toBe(true);
    expect(snapshot.threads.map((item) => item.contextId)).toContain(thread.contextId);
    expect(snapshot.rejectedWindows[thread.contextId]).toEqual(source.rejectedWindows[thread.contextId]);
  });

  it.skipIf(!allowWipe)("replaces everything from a snapshot and keeps recorded runs", async () => {
    const before = await store.listRecordedRuns();
    const seed = recordedSnapshot();
    await timed("replaceAll", () => store.replaceAll(seed));
    const after = await store.snapshot();
    expect(after.threads).toEqual(seed.threads);
    expect(after.messages).toEqual(seed.messages);
    expect(after.rejectedWindows).toEqual(seed.rejectedWindows);
    expect((await store.listRecordedRuns()).length).toBe(before.length);
  });
});
