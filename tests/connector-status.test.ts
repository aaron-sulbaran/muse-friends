import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/connector/status/route";
import { buildStatus, readStoreSummary } from "@/app/api/mcp/_lib/status";
import { recordedSnapshot } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import type { Store } from "@/lib/store";

const tokenA = "a".repeat(48);
const tokenB = "b".repeat(48);

const call = (headers: Record<string, string> = {}) =>
  GET(new Request("https://muse-friends.test/api/connector/status", { headers }));

describe("GET /api/connector/status", () => {
  const shared = globalThis as typeof globalThis & { __museStore?: unknown };

  beforeEach(() => {
    vi.stubEnv("MCP_TOKEN_A", tokenA);
    vi.stubEnv("MCP_TOKEN_B", tokenB);
    vi.stubEnv("STORE", "json");
    vi.stubEnv("STORE_PATH", path.join(mkdtempSync(path.join(tmpdir(), "muse-connector-")), "store.json"));
    delete shared.__museStore;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    delete shared.__museStore;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("refuses a request with no key, a wrong key, or no configured tokens", async () => {
    expect((await call()).status).toBe(401);
    expect((await call({ authorization: `Bearer ${"c".repeat(48)}` })).status).toBe(401);
    vi.stubEnv("MCP_TOKEN_A", "");
    vi.stubEnv("MCP_TOKEN_B", "");
    const closed = await call({ authorization: "Bearer " });
    expect(closed.status).toBe(401);
    expect(await closed.json()).toEqual({ data: null, error: { message: "A valid key is required" } });
    expect(closed.headers.get("www-authenticate")).toContain("Bearer");
  });

  it("answers with the status for the account that owns the key, as a bearer or an x-api-key", async () => {
    const bearer = await call({ authorization: `Bearer ${tokenB}` });
    expect(bearer.status).toBe(200);
    const body = await bearer.json();
    expect(body.error).toBeNull();
    expect(body.data).toMatchObject({ ok: true, service: "muse-friends", account: "b" });
    expect(body.data.store).toEqual({ kind: "json", threads: 0, messages: 0, plans: 0, cards: 0, events: 0 });
    expect(bearer.headers.get("cache-control")).toBe("no-store");

    const apiKey = await call({ "x-api-key": tokenA });
    expect((await apiKey.json()).data.account).toBe("a");
  });

  it("never writes a key into the logs", async () => {
    await call({ authorization: `Bearer ${tokenA}` });
    await call({ authorization: `Bearer ${"c".repeat(48)}` });
    const logged = JSON.stringify(vi.mocked(console.log).mock.calls);
    expect(logged).not.toContain(tokenA);
    expect(logged).not.toContain("c".repeat(48));
  });
});

describe("readStoreSummary", () => {
  it("counts what is stored and nothing about its content", async () => {
    const store = new JsonStore(null);
    await store.replaceAll(recordedSnapshot());
    const summary = await readStoreSummary(store);
    expect(summary).toMatchObject({ threads: 1, messages: 6, plans: 1, cards: 2 });
    expect(Object.keys(summary).sort()).toEqual(["cards", "events", "kind", "messages", "plans", "threads"]);
    expect(JSON.stringify(summary)).not.toMatch(/shawarma|Shawarma/);
  });

  it("reports a store that cannot be read instead of throwing, and the status says not ok", async () => {
    const broken = {
      snapshot: async () => {
        throw new Error("supabase store snapshot failed: down");
      },
    } as unknown as Store;
    const summary = await readStoreSummary(broken);
    expect(summary).toEqual({ kind: "json", error: "supabase store snapshot failed: down" });
    expect(buildStatus("a", summary).ok).toBe(false);
  });
});
