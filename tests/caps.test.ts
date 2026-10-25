import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_GLOBAL_LIMIT,
  DEFAULT_ROOM_LIMIT,
  PAUSED_TEXT,
  WINDOW_MS,
  limits,
  refundRun,
  reserveRun,
  resetRunBudget,
  runBudget,
} from "@/lib/agent/caps";
import { resetDemo } from "@/lib/agent/controls";
import { JsonStore } from "@/lib/store/json";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";

const scheduled: Array<() => unknown> = [];
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (callback: () => unknown) => void scheduled.push(callback) }));

const T0 = Date.parse("2026-10-25T00:00:00Z");
const ENV = ["MAX_LIVE_RUNS_PER_ROOM_PER_HOUR", "MAX_LIVE_RUNS_PER_HOUR"];

beforeEach(() => {
  resetRunBudget();
  scheduled.length = 0;
  for (const name of ENV) delete process.env[name];
});
afterEach(() => {
  for (const name of ENV) delete process.env[name];
  removeFakeModel();
  (globalThis as { __museStore?: unknown }).__museStore = undefined;
});

describe("the caps", () => {
  it("default to 30 live runs per room per hour and 60 in all", () => {
    expect([DEFAULT_ROOM_LIMIT, DEFAULT_GLOBAL_LIMIT]).toEqual([30, 60]);
    expect(limits()).toEqual({ room: 30, global: 60 });
  });

  it("read the global cap from MAX_LIVE_RUNS_PER_HOUR and the room cap from MAX_LIVE_RUNS_PER_ROOM_PER_HOUR", () => {
    process.env.MAX_LIVE_RUNS_PER_HOUR = "5";
    process.env.MAX_LIVE_RUNS_PER_ROOM_PER_HOUR = "2";
    expect(limits()).toEqual({ room: 2, global: 5 });
    process.env.MAX_LIVE_RUNS_PER_HOUR = "nonsense";
    process.env.MAX_LIVE_RUNS_PER_ROOM_PER_HOUR = "";
    expect(limits()).toEqual({ room: 30, global: 60 });
  });

  it("pause a room after its 30th run, with the plain line, while other rooms carry on", () => {
    for (let run = 1; run <= 30; run += 1) expect(reserveRun("demo", T0 + run).ok).toBe(true);
    const blocked = reserveRun("demo", T0 + 31);
    expect(blocked).toMatchObject({ ok: false, reason: "room", text: "Live runs paused, playing a recording" });
    expect(PAUSED_TEXT).toBe("Live runs paused, playing a recording");
    expect(blocked.budget).toMatchObject({ paused: true, reason: "room", room: { used: 30, limit: 30, remaining: 0 }, global: { used: 30, limit: 60, remaining: 30 } });
    expect(reserveRun("other-room", T0 + 32).ok).toBe(true);
  });

  it("pause every room once the global cap is reached, whichever rooms the runs came from", () => {
    process.env.MAX_LIVE_RUNS_PER_HOUR = "3";
    expect(reserveRun("a", T0).ok).toBe(true);
    expect(reserveRun("b", T0 + 1).ok).toBe(true);
    expect(reserveRun("c", T0 + 2).ok).toBe(true);
    for (const room of ["a", "b", "c", "d"]) {
      expect(reserveRun(room, T0 + 3)).toMatchObject({ ok: false, reason: "global", text: PAUSED_TEXT });
    }
  });

  it("slide: a slot opens an hour after the run that took it, and the pause says how long to wait", () => {
    process.env.MAX_LIVE_RUNS_PER_ROOM_PER_HOUR = "2";
    reserveRun("demo", T0);
    reserveRun("demo", T0 + 60_000);
    const paused = runBudget("demo", T0 + 30 * 60_000);
    expect(paused).toMatchObject({ paused: true, reason: "room", retryAfterSeconds: 30 * 60 });
    expect(reserveRun("demo", T0 + WINDOW_MS - 1).ok).toBe(false);
    expect(reserveRun("demo", T0 + WINDOW_MS + 1).ok).toBe(true);
    expect(runBudget("demo", T0 + WINDOW_MS + 2).room.used).toBe(2);
  });

  it("give a slot back when a reserved run never started a model turn", () => {
    process.env.MAX_LIVE_RUNS_PER_ROOM_PER_HOUR = "1";
    expect(reserveRun("demo", T0).ok).toBe(true);
    expect(reserveRun("demo", T0 + 1).ok).toBe(false);
    refundRun("demo", T0 + 2);
    expect(reserveRun("demo", T0 + 3).ok).toBe(true);
  });

  it("treat 0 as paused, and never count a paused attempt", () => {
    process.env.MAX_LIVE_RUNS_PER_ROOM_PER_HOUR = "0";
    expect(reserveRun("demo", T0)).toMatchObject({ ok: false, reason: "room" });
    expect(runBudget("demo", T0).room.used).toBe(0);
  });

  it("are not cleared by Reset, because the credits are already spent", async () => {
    reserveRun("demo");
    reserveRun("demo");
    const store = new JsonStore(null);
    await resetDemo(store);
    expect(runBudget().room.used).toBe(2);
  });

  it("report counters shaped for the JSON drawer", () => {
    reserveRun("demo", T0);
    expect(runBudget("demo", T0 + 1)).toEqual({
      windowMinutes: 60,
      room: { used: 1, limit: 30, remaining: 29 },
      global: { used: 1, limit: 60, remaining: 59 },
      paused: false,
      reason: undefined,
      retryAfterSeconds: undefined,
    });
  });
});

describe("POST /api/signals under the caps", () => {
  let store: JsonStore;
  beforeEach(() => {
    store = new JsonStore(null);
    process.env.STORE_PATH = path.join(mkdtempSync(path.join(tmpdir(), "muse-caps-")), "store.json");
    (globalThis as { __museStore?: unknown }).__museStore = Promise.resolve(store);
  });

  const post = async () => {
    const { POST } = await import("@/app/api/signals/route");
    return POST(new Request("http://localhost:3001/api/signals", { method: "POST", body: "{}" }));
  };

  it("counts each live run and returns the counters", async () => {
    const response = await post();
    expect(response.status).toBe(202);
    expect((await response.json()).budget).toMatchObject({ room: { used: 1, limit: 30 }, global: { used: 1, limit: 60 }, paused: false });
    expect(scheduled).toHaveLength(1);
  });

  it("answers 429 with the plain line once the room cap is spent, and starts nothing", async () => {
    process.env.MAX_LIVE_RUNS_PER_ROOM_PER_HOUR = "2";
    expect((await post()).status).toBe(202);
    expect((await post()).status).toBe(202);
    scheduled.length = 0;
    const plansBefore = (await store.listPlans()).length;
    const model = installFakeModel([]);

    const blocked = await post();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await blocked.json()).toMatchObject({ paused: true, reason: "room", text: "Live runs paused, playing a recording", budget: { paused: true, room: { used: 2, limit: 2, remaining: 0 } } });
    expect((await store.listPlans()).length).toBe(plansBefore);
    expect(scheduled).toHaveLength(0);
    expect(model.calls).toHaveLength(0);
  });

  it("answers 429 reason global once the app-wide cap is spent, even for a fresh room", async () => {
    process.env.MAX_LIVE_RUNS_PER_HOUR = "1";
    reserveRun("some-other-room");
    const blocked = await post();
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ paused: true, reason: "global", text: PAUSED_TEXT });
  });

  it("keeps the room paused through a Reset", async () => {
    process.env.MAX_LIVE_RUNS_PER_ROOM_PER_HOUR = "1";
    expect((await post()).status).toBe(202);
    await resetDemo(store);
    expect((await post()).status).toBe(429);
  });

  it("serves the counters on GET for the JSON drawer", async () => {
    reserveRun("demo");
    const { GET } = await import("@/app/api/signals/route");
    const body = await (await GET()).json();
    expect(body.budget).toMatchObject({ windowMinutes: 60, room: { used: 1, limit: 30, remaining: 29 }, global: { used: 1, limit: 60 }, paused: false });
  });

  it("does not spend a slot on a bad request", async () => {
    const { POST } = await import("@/app/api/signals/route");
    const bad = await POST(new Request("http://localhost:3001/api/signals", { method: "POST", body: JSON.stringify({ scenario: "ski-trip" }) }));
    expect(bad.status).toBe(400);
    expect(runBudget().room.used).toBe(0);
  });
});
