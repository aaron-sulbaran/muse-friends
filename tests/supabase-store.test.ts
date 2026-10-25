import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ROOM } from "@/lib/seed/fixtures";
import { createSupabaseStore, StoreError } from "@/lib/store/supabase";

// A stand-in for the PostgREST query builder: every step returns itself and awaiting it yields
// the canned outcome, which is all the store needs to turn an error into a StoreError.
function clientReplying(outcome: { data: unknown; error: { message: string } | null }) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) => resolve(outcome),
  };
  for (const step of ["select", "eq", "order", "upsert", "maybeSingle"]) builder[step] = () => builder;
  return { from: () => builder, rpc: () => builder } as unknown as SupabaseClient;
}

describe("createSupabaseStore", () => {
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

  it("turns a database error into a StoreError that names the operation", async () => {
    const store = createSupabaseStore({ client: clientReplying({ data: null, error: { message: "boom" } }) });
    await expect(store.listPlans()).rejects.toThrowError(StoreError);
    await expect(store.listPlans()).rejects.toThrowError("supabase store listPlans failed: boom");
    await expect(store.getThread("ctx_x")).rejects.toThrowError("supabase store getThread failed: boom");
  });

  it("returns null for a missing document and an empty list for no rows", async () => {
    const store = createSupabaseStore({ client: clientReplying({ data: null, error: null }) });
    expect(await store.getThread("ctx_missing")).toBeNull();
    expect(await store.listThreads()).toEqual([]);
    expect(await store.listRejectedWindows("ctx_missing")).toEqual([]);
  });

  it("falls back to the demo start when no clock has been stored", async () => {
    const store = createSupabaseStore({ client: clientReplying({ data: null, error: null }) });
    const clock = await store.getClock();
    expect(Date.parse(clock.now)).not.toBeNaN();
  });

  it("falls back to the default demo room when none is stored", async () => {
    const store = createSupabaseStore({ client: clientReplying({ data: null, error: null }) });
    expect(await store.getRoom()).toEqual(DEFAULT_ROOM);
  });

  it("reports the cursor as a string and starts at zero when the counter row is missing", async () => {
    const withCounter = createSupabaseStore({ client: clientReplying({ data: { version: 7 }, error: null }) });
    expect(await withCounter.cursor()).toBe("7");
    const withoutCounter = createSupabaseStore({ client: clientReplying({ data: null, error: null }) });
    expect(await withoutCounter.cursor()).toBe("0");
  });

  it("lists no busy blocks when there are none", async () => {
    const store = createSupabaseStore({ client: clientReplying({ data: null, error: null }) });
    expect(await store.listBusy("aaron")).toEqual([]);
  });
});
