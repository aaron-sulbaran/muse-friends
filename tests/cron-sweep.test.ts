import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/sweep/route";
import { sweepPlans } from "@/app/api/cron/sweep/_lib/sweep";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { getStore } from "@/lib/store";
import { JsonStore } from "@/lib/store/json";

// The seeded plan is Tuesday Oct 27, 6 to 8pm Central. Its three moments in real time:
const HOUR = 3_600_000;
const START = Date.parse("2026-10-27T18:00:00-05:00");
const END = Date.parse("2026-10-27T20:00:00-05:00");
const BEFORE_REMINDER = START - 2 * HOUR - 60_000;
const AT_REMINDER = START - 2 * HOUR;
const LONG_AFTER = END + 15 * HOUR;

async function storeAt(state: Parameters<typeof snapshotAtPlanState>[0]) {
  const store = new JsonStore(null);
  await store.replaceAll(snapshotAtPlanState(state));
  return store;
}

const stamps = async (store: JsonStore) =>
  (await store.listEvents()).filter((event) => event.text.startsWith("Scheduled sweep"));

describe("sweepPlans", () => {
  it("does nothing before a plan's next step is due, and writes no row", async () => {
    const store = await storeAt("scheduled");
    const result = await sweepPlans(store, BEFORE_REMINDER);
    expect(result).toMatchObject({ checked: 1, advanced: 0, skipped: 0, transitions: [] });
    expect((await store.listPlans())[0].state).toBe("scheduled");
    expect(await stamps(store)).toHaveLength(0);
  });

  it("runs the reminder once its moment has passed, with one Scheduled row for the transition", async () => {
    const store = await storeAt("scheduled");
    const result = await sweepPlans(store, AT_REMINDER);
    expect(result.advanced).toBe(1);
    expect(result.transitions).toEqual([{ planId: "plan_shawarma_001", step: "reminder", from: "scheduled", to: "reminded" }]);
    expect((await store.listPlans())[0].state).toBe("reminded");

    const rows = await stamps(store);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "plan_state", actor: "system", planId: "plan_shawarma_001" });
    expect(rows[0].text).toBe("Scheduled sweep: Shawarma Point moved from scheduled to reminded");
  });

  it("walks a plan through every due step in order, one row per transition", async () => {
    const store = await storeAt("confirmed");
    const result = await sweepPlans(store, LONG_AFTER);
    expect(result.transitions.map((entry) => entry.step)).toEqual(["reminder", "end", "next_day"]);
    expect(result.transitions.at(-1)?.to).toBe("followed_up");
    expect((await store.listPlans())[0].state).toBe("followed_up");
    expect(await stamps(store)).toHaveLength(3);
  });

  it("is idempotent: a second run, or a duplicate delivery, finds nothing to do", async () => {
    const store = await storeAt("confirmed");
    await sweepPlans(store, LONG_AFTER);
    const eventsAfterFirst = (await store.listEvents()).length;
    const plansAfterFirst = JSON.stringify(await store.listPlans());

    const again = await sweepPlans(store, LONG_AFTER);
    expect(again).toMatchObject({ advanced: 0, skipped: 0, transitions: [] });
    expect((await store.listEvents()).length).toBe(eventsAfterFirst);
    expect(JSON.stringify(await store.listPlans())).toBe(plansAfterFirst);
  });

  it("leaves plans alone that no step applies to: waiting on people, or dropped", async () => {
    for (const state of ["awaiting_humans", "dropped"] as const) {
      const store = await storeAt(state);
      const before = JSON.stringify(await store.listPlans());
      const result = await sweepPlans(store, LONG_AFTER);
      expect(result).toMatchObject({ advanced: 0, skipped: 0 });
      expect(JSON.stringify(await store.listPlans())).toBe(before);
      expect(await stamps(store)).toHaveLength(0);
    }
  });
});

describe("GET /api/cron/sweep", () => {
  const secret = "s".repeat(64);
  const shared = globalThis as typeof globalThis & { __museStore?: unknown };
  const call = (authorization?: string) =>
    GET(new Request("https://muse-friends.test/api/cron/sweep", { headers: authorization ? { authorization } : {} }));

  beforeEach(() => {
    // The route reads getStore(); keep it the local JSON store in a temp file so no test can reach the
    // production store or the demo room.
    vi.stubEnv("STORE", "json");
    vi.stubEnv("STORE_PATH", path.join(mkdtempSync(path.join(tmpdir(), "muse-cron-")), "store.json"));
    vi.stubEnv("CRON_SECRET", secret);
    delete shared.__museStore;
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete shared.__museStore;
    vi.unstubAllEnvs();
  });

  it("is closed by default: 503 for everyone while CRON_SECRET is unset or too short", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const unset = await call(`Bearer ${secret}`);
    expect(unset.status).toBe(503);
    expect(await unset.json()).toEqual({ data: null, error: { message: "CRON_SECRET is not set" } });
    vi.stubEnv("CRON_SECRET", "short");
    expect((await call("Bearer short")).status).toBe(503);
  });

  it("answers 401 without the bearer secret, or with a wrong or malformed one", async () => {
    expect((await call()).status).toBe(401);
    expect((await call(`Bearer ${"x".repeat(64)}`)).status).toBe(401);
    expect((await call(secret)).status).toBe(401);
    expect((await call(`Bearer ${secret}extra`)).status).toBe(401);
  });

  it("runs the sweep for the right secret and returns counts as JSON, then does nothing the second time", async () => {
    const store = await getStore();
    await store.replaceAll(snapshotAtPlanState("scheduled"));
    vi.setSystemTime(LONG_AFTER);

    const first = await call(`Bearer ${secret}`);
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const firstBody = await first.json();
    expect(firstBody.error).toBeNull();
    expect(firstBody.data).toMatchObject({ checked: 1, advanced: 3, skipped: 0 });
    expect(firstBody.data.transitions.map((entry: { to: string }) => entry.to)).toEqual(["reminded", "happened", "followed_up"]);

    const second = await (await call(`Bearer ${secret}`)).json();
    expect(second.data).toMatchObject({ checked: 1, advanced: 0, skipped: 0, transitions: [] });
    const rows = (await store.listEvents()).filter((event) => event.text.startsWith("Scheduled sweep"));
    expect(rows).toHaveLength(3);
  });
});
