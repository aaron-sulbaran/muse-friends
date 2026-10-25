import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM, recordedSnapshot, seedSnapshot } from "@/lib/seed/fixtures";
import { getStore } from "@/lib/store";
import { createSupabaseStore, StoreError } from "@/lib/store/supabase";

type Call = { table: string; steps: string[]; args: unknown[][] };
type Outcome = { data: unknown; error: { message: string } | null };

// A stand-in for the PostgREST query builder. Every step returns the builder; awaiting it records
// the call and yields whatever `respond` says, which is all the store needs.
function fakeClient(respond: (call: Call) => Outcome = () => ({ data: null, error: null })) {
  const calls: Call[] = [];
  const builderFor = (table: string) => {
    const call: Call = { table, steps: [], args: [] };
    const builder: Record<string, unknown> = {
      then: (resolve: (value: unknown) => unknown) => {
        calls.push(call);
        return resolve(respond(call));
      },
    };
    for (const step of ["select", "eq", "order", "upsert", "maybeSingle"]) {
      builder[step] = (...args: unknown[]) => {
        call.steps.push(step);
        call.args.push(args);
        return builder;
      };
    }
    return builder;
  };
  const client = {
    from: (table: string) => builderFor(table),
    rpc: (name: string) => builderFor(`rpc:${name}`),
  } as unknown as SupabaseClient;
  return { client, calls };
}

const unseeded = { seedDefaults: false } as const;
const upsertsTo = (calls: Call[], table: string) =>
  calls.filter((call) => call.table === table && call.steps.includes("upsert"));
const roomLookups = (calls: Call[]) => calls.filter((call) => call.table === "room" && call.steps.includes("select"));

describe("createSupabaseStore setup", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("names the missing variable, never a value, when the environment is not set up", () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => createSupabaseStore()).toThrowError(/SUPABASE_URL is not set/);
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    expect(() => createSupabaseStore()).toThrowError(/SUPABASE_SERVICE_ROLE_KEY is not set/);
  });
});

describe("the STORE=supabase entry point", () => {
  const shared = globalThis as typeof globalThis & { __museStore?: unknown };

  afterEach(() => {
    delete shared.__museStore;
    vi.unstubAllEnvs();
  });

  it("is what getStore loads, so the factory switch reaches this file", async () => {
    vi.stubEnv("STORE", "supabase");
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "x".repeat(40));
    delete shared.__museStore;
    const store = await getStore();
    expect(typeof store.snapshot).toBe("function");
    expect(typeof store.cursor).toBe("function");
  });
});

describe("createSupabaseStore reads and writes", () => {
  it("turns a database error into a StoreError that names the operation", async () => {
    const { client } = fakeClient(() => ({ data: null, error: { message: "boom" } }));
    const store = createSupabaseStore({ client, ...unseeded });
    await expect(store.listPlans()).rejects.toThrowError(StoreError);
    await expect(store.listPlans()).rejects.toThrowError("supabase store listPlans failed: boom");
    await expect(store.getThread("ctx_x")).rejects.toThrowError("supabase store getThread failed: boom");
  });

  it("returns null for a missing document and an empty list for no rows", async () => {
    const { client } = fakeClient();
    const store = createSupabaseStore({ client, ...unseeded });
    expect(await store.getThread("ctx_missing")).toBeNull();
    expect(await store.listThreads()).toEqual([]);
    expect(await store.listRejectedWindows("ctx_missing")).toEqual([]);
    expect(await store.listBusy("aaron")).toEqual([]);
  });

  it("falls back to the default room and the demo clock when none is stored", async () => {
    const { client } = fakeClient();
    const store = createSupabaseStore({ client, ...unseeded });
    expect(await store.getRoom()).toEqual(DEFAULT_ROOM);
    expect(Date.parse((await store.getClock()).now)).not.toBeNaN();
  });

  it("reports the cursor as a string and starts at zero when the counter row is missing", async () => {
    const withCounter = createSupabaseStore({
      client: fakeClient(() => ({ data: { version: 7 }, error: null })).client,
      ...unseeded,
    });
    expect(await withCounter.cursor()).toBe("7");
    const withoutCounter = createSupabaseStore({ client: fakeClient().client, ...unseeded });
    expect(await withoutCounter.cursor()).toBe("0");
  });

  it("returns messages in the JSON store's order: contextId, then position in the thread", async () => {
    const records = recordedSnapshot().messages;
    const shuffled = [records[3], records[0], records[5], records[1], records[4], records[2]];
    const { client } = fakeClient(() => ({ data: shuffled.map((record) => ({ data: record })), error: null }));
    const store = createSupabaseStore({ client, ...unseeded });
    expect((await store.listMessages()).map((record) => record.message.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("replaces a message in place, unlike an append that ignores duplicates", async () => {
    const { client, calls } = fakeClient();
    const store = createSupabaseStore({ client, ...unseeded });
    const [record] = recordedSnapshot().messages;
    await store.appendMessage(record);
    await store.replaceMessage({ ...record, stamp: { ...record.stamp, removed: ["location"] } });
    const [append, replace] = upsertsTo(calls, "messages");
    const optionsOf = (call: Call) => call.args[call.steps.indexOf("upsert")][1] as Record<string, unknown>;
    expect(optionsOf(append)).toMatchObject({ onConflict: "context_id,seq", ignoreDuplicates: true });
    expect(optionsOf(replace)).toEqual({ onConflict: "context_id,seq" });
  });

  it("refuses a malformed snapshot before it reaches the database", async () => {
    const { client, calls } = fakeClient();
    const store = createSupabaseStore({ client, ...unseeded });
    await expect(store.replaceAll({ clock: { now: "not a time" } } as never)).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("seeding an empty database", () => {
  const emptyDatabase = (): Outcome => ({ data: null, error: null });
  const hasRoom = (call: Call): Outcome => ({ data: call.table === "room" ? { id: "demo" } : null, error: null });

  it("writes the room, clock, and default policies with ignore-duplicates upserts on first use", async () => {
    const { client, calls } = fakeClient(emptyDatabase);
    const store = createSupabaseStore({ client });
    await store.getThread("ctx_x");
    expect(upsertsTo(calls, "room")).toHaveLength(1);
    expect(upsertsTo(calls, "clock")).toHaveLength(1);
    const policyUpserts = upsertsTo(calls, "policies");
    expect(policyUpserts).toHaveLength(1);
    const [rows, options] = policyUpserts[0].args[policyUpserts[0].steps.indexOf("upsert")] as [
      unknown[],
      Record<string, unknown>,
    ];
    expect(rows).toHaveLength(seedSnapshot().policies.length);
    expect(options).toMatchObject({ onConflict: "owner,friend", ignoreDuplicates: true });
  });

  it("seeds once per process, even when several calls arrive together", async () => {
    const { client, calls } = fakeClient(emptyDatabase);
    const store = createSupabaseStore({ client });
    await Promise.all([store.getThread("a"), store.getPlan("b"), store.listSignals()]);
    await store.getThread("c");
    expect(roomLookups(calls)).toHaveLength(1);
    expect(upsertsTo(calls, "room")).toHaveLength(1);
  });

  it("leaves a database that already has a room alone, so a reset is never undone", async () => {
    const { client, calls } = fakeClient(hasRoom);
    const store = createSupabaseStore({ client });
    await store.getThread("ctx_x");
    expect(upsertsTo(calls, "room")).toHaveLength(0);
    expect(upsertsTo(calls, "clock")).toHaveLength(0);
    expect(upsertsTo(calls, "policies")).toHaveLength(0);
  });

  it("retries the seed on the next call when it failed", async () => {
    let failures = 1;
    const { client } = fakeClient((call) => {
      if (call.table === "room" && call.steps.includes("select") && failures-- > 0) {
        return { data: null, error: { message: "down" } };
      }
      return { data: null, error: null };
    });
    const store = createSupabaseStore({ client });
    await expect(store.getThread("ctx_x")).rejects.toThrowError("supabase store seed failed: down");
    await expect(store.getThread("ctx_x")).resolves.toBeNull();
  });
});
