import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPlan, parseFreeWindows, respond, startPlan, type ByomDeps } from "@/app/api/connector/_lib/byom";
import { persistingStore } from "@/app/api/connector/_lib/room-store";
import { ROOM_TTL_MS, RoomStorageError, clearMemoryRooms, memoryRoomRepo } from "@/app/api/connector/_lib/rooms";
import { ownCalendar, ownFreeBlocks } from "@/lib/agent/calendar";
import { resetRunBudget } from "@/lib/agent/caps";
import { transitionPlan } from "@/lib/plans";
import type { Plan, StateSnapshot } from "@/lib/protocol";
import { getPersona, recordedSnapshot } from "@/lib/seed/fixtures";
import { getStore, type Store } from "@/lib/store";
import { JsonStore } from "@/lib/store/json";

// Sunday Oct 25, 3pm Central: the expo afternoon.
const NOW = Date.parse("2026-10-25T15:00:00-05:00");
// Thursday evening: Mochi is free after 6:30pm, and Sprout's seeded library shift (3 to 10pm) would
// swallow it if the seeded calendar still applied.
const THURSDAY_EVENING = [{ day: "2026-10-29", start: "19:00", end: "21:00" }];
// Wednesday just after Mochi's classes and before her book club.
const WEDNESDAY_EARLY_EVENING = [{ day: "2026-10-28", start: "18:00", end: "19:00" }];

type Harness = ReturnType<typeof harness>;

function harness(overrides: Partial<ByomDeps> = {}) {
  const repo = memoryRoomRepo();
  const scheduled: Array<() => Promise<void>> = [];
  let now = NOW;
  const mochiAnswers: string[] = [];
  const deps: ByomDeps = {
    repo,
    now: () => now,
    schedule: (work) => void scheduled.push(work),
    mochi: async () => {
      mochiAnswers.push("asked");
      return "accept";
    },
    negotiate: agreeOnRamen,
    ...overrides,
  };
  return { deps, repo, scheduled, mochiAnswers, advance: (ms: number) => (now += ms), runScheduled: async () => void (await Promise.all(scheduled.splice(0).map((work) => work()))) };
}

// A stand-in for the two agents' conversation: three messages, then the plan waits on the people.
async function agreeOnRamen(store: Store, input: { contextId: string }): Promise<void> {
  const [plan] = await store.listPlans();
  const base = recordedSnapshot();
  for (const [index, record] of base.messages.slice(0, 3).entries()) {
    await store.appendMessage({ ...record, message: { ...record.message, id: `msg_stub_${index + 1}`, contextId: input.contextId, seq: index + 1 } });
  }
  const at = "2026-10-25T15:00:30-05:00";
  const negotiating = transitionPlan(plan, "negotiating", at);
  const waiting = transitionPlan(negotiating, "awaiting_humans", at, { note: "Both agents accepted" });
  const window = { start: "2026-10-29T19:00:00-05:00", end: "2026-10-29T21:00:00-05:00" };
  await store.putPlan({ ...waiting, window, activity: { kind: "food", title: "Ramen", place: "Downtown" }, draft: "Hey Mochi, ramen Thursday at 7? Want to go?" } satisfies Plan);
}

async function start(h: Harness, input: unknown = { free_windows: THURSDAY_EVENING }) {
  const outcome = await startPlan(input, h.deps);
  if (!outcome.ok) throw new Error(`start_plan failed: ${outcome.code} ${outcome.message}`);
  return outcome.value;
}

beforeEach(() => {
  clearMemoryRooms();
  resetRunBudget();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clearMemoryRooms();
  resetRunBudget();
});

describe("free windows are checked in code", () => {
  const parse = (windows: Array<{ day: string; start: string; end: string }>) => parseFreeWindows(windows, NOW);
  const refusal = (windows: Array<{ day: string; start: string; end: string }>) => {
    const result = parse(windows);
    return result.ok ? null : { code: result.code, message: result.message };
  };

  it("accepts whole-hour windows in the week and returns them sorted, as Central times", () => {
    const result = parse([
      { day: "2026-10-30", start: "18:00", end: "20:00" },
      { day: "2026-10-27", start: "17:00", end: "19:00" },
    ]);
    expect(result).toEqual({
      ok: true,
      value: [
        { start: "2026-10-27T17:00:00-05:00", end: "2026-10-27T19:00:00-05:00" },
        { start: "2026-10-30T18:00:00-05:00", end: "2026-10-30T20:00:00-05:00" },
      ],
    });
  });

  it("refuses a window that ends before it starts, or that is not inside waking hours", () => {
    expect(refusal([{ day: "2026-10-27", start: "20:00", end: "18:00" }])?.code).toBe("bad_window");
    expect(refusal([{ day: "2026-10-27", start: "07:00", end: "09:00" }])?.message).toContain("between 09:00 and 22:00");
    expect(refusal([{ day: "2026-10-27", start: "21:00", end: "23:00" }])?.code).toBe("bad_window");
  });

  it("refuses a day that is not a real date", () => {
    expect(refusal([{ day: "2026-02-31", start: "18:00", end: "20:00" }])?.message).toContain("not a real date");
  });

  it("refuses a window already over, more than 7 days out, or outside the demo week", () => {
    expect(refusal([{ day: "2026-10-25", start: "09:00", end: "11:00" }])?.code).toBe("window_in_past");
    expect(refusal([{ day: "2026-11-03", start: "18:00", end: "20:00" }])?.code).toBe("window_too_far");
    expect(refusal([{ day: "2026-11-01", start: "10:00", end: "12:00" }])?.code).toBe("outside_calendar");
  });

  it("refuses windows that overlap each other", () => {
    expect(refusal([{ day: "2026-10-27", start: "17:00", end: "20:00" }, { day: "2026-10-27", start: "19:00", end: "21:00" }])?.code).toBe("windows_overlap");
  });
});

describe("start_plan", () => {
  it("refuses more than 3 windows, none, minutes, and extra shapes, as bad input", async () => {
    const h = harness();
    const four = Array.from({ length: 4 }, (_, index) => ({ day: `2026-10-${26 + index}`, start: "18:00", end: "20:00" }));
    for (const input of [{ free_windows: four }, { free_windows: [] }, {}, { free_windows: [{ day: "2026-10-29", start: "18:30", end: "20:00" }] }, { free_windows: [{ day: "Thursday", start: "18:00", end: "20:00" }] }]) {
      const result = await startPlan(input, h.deps);
      expect(result.ok).toBe(false);
      expect(result.ok ? 0 : result.status).toBe(400);
    }
    expect(h.scheduled).toHaveLength(0);
    const tooMany = await startPlan({ free_windows: four }, h.deps);
    expect(tooMany.ok ? "" : tooMany.message).toContain("at most 3");
  });

  it("drops the free-text hint, never storing it, when BYOM_ALLOW_HINT is 0", async () => {
    vi.stubEnv("BYOM_ALLOW_HINT", "0");
    const h = harness();
    const started = await start(h, { reel_hint: "dinner with my wife on our anniversary", free_windows: THURSDAY_EVENING });
    expect(started.reel_hint).toBe("ignored: this server does not take free text");
    const snapshot = (await h.repo.load(started.planId, NOW))!;
    expect(JSON.stringify(snapshot)).not.toContain("anniversary");
    expect(snapshot.signals[0].media.caption).not.toContain("wife");
  });

  it("says whether the hint was used", async () => {
    expect((await start(harness(), { reel_hint: "ramen", free_windows: THURSDAY_EVENING })).reel_hint).toBe("used");
    expect((await start(harness(), { free_windows: THURSDAY_EVENING })).reel_hint).toBe("not given");
  });

  it("refuses a reel_hint over 140 characters", async () => {
    const result = await startPlan({ reel_hint: "x".repeat(141), free_windows: THURSDAY_EVENING }, harness().deps);
    expect(result.ok).toBe(false);
  });

  it("creates an isolated room, returns its key and how to check, and schedules the conversation", async () => {
    const h = harness();
    const started = await start(h, { reel_hint: "ramen near campus", free_windows: THURSDAY_EVENING });
    expect(started.planId).toMatch(/^room_[A-Za-z0-9_-]{16}$/);
    expect(started.contextId).toMatch(/^ctx_/);
    expect(started.state).toBe("negotiating");
    expect(started.how_to_check).toContain(started.planId);
    expect(started.how_to_check).toContain("check_plan");
    expect(started.expires_in_minutes).toBe(120);
    expect(h.scheduled).toHaveLength(1);

    const snapshot = (await h.repo.load(started.planId, NOW))!;
    expect(snapshot.room.simulatedFriend).toBe(true);
    expect(snapshot.plans).toHaveLength(1);
    expect(snapshot.plans[0].state).toBe("detected");
    expect(snapshot.signals[0].media.caption).toBe("ramen near campus");
    expect(snapshot.clock.now).toBe("2026-10-25T15:00:00-05:00");
  });

  it("makes Sprout's calendar exactly the windows typed, not the seeded persona's", async () => {
    const h = harness();
    const started = await start(h);
    const store = new JsonStore(null);
    await store.replaceAll((await h.repo.load(started.planId, NOW))!);

    expect(await ownFreeBlocks(store, "aaron")).toEqual([{ start: "2026-10-29T19:00:00-05:00", end: "2026-10-29T21:00:00-05:00" }]);
    // The seeded library shift is not part of this calendar, only busy blocks around the typed window.
    const titles = (await ownCalendar(store, "aaron")).map((event) => event.title);
    expect(titles).not.toContain("Library closing shift");
    expect(new Set(titles)).toEqual(new Set(["Busy"]));
    // Mochi keeps her own seeded calendar.
    expect((await ownCalendar(store, "lisa")).map((event) => event.id)).toEqual(getPersona("lisa").calendar.map((event) => event.id));
  });

  it("refuses, before any model call, windows Mochi could not also do, and says when she is free", async () => {
    const h = harness();
    const result = await startPlan({ free_windows: [{ day: "2026-10-27", start: "10:00", end: "12:00" }] }, h.deps);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(422);
    expect(result.code).toBe("no_overlap_with_mochi");
    expect((result.hint as { mochi_is_free: unknown[] }).mochi_is_free.length).toBeGreaterThan(0);
    expect(h.scheduled).toHaveLength(0);
    expect(await h.repo.countCreatedSince(0)).toBe(0);
  });

  it("caps live rooms per hour across everyone, and the cap is counted in the repository", async () => {
    const h = harness({ maxRoomsPerHour: 2 });
    await start(h);
    await start(h);
    const third = await startPlan({ free_windows: THURSDAY_EVENING }, h.deps);
    expect(third.ok).toBe(false);
    if (third.ok) return;
    expect(third).toMatchObject({ status: 429, code: "room_cap", retryAfterSeconds: 300 });
    // An hour later the first two no longer count.
    h.advance(61 * 60 * 1000);
    expect((await startPlan({ free_windows: WEDNESDAY_EARLY_EVENING }, h.deps)).ok).toBe(true);
  });

  it("stops when the app's hourly run budget is spent, and creates nothing", async () => {
    vi.stubEnv("MAX_LIVE_RUNS_PER_HOUR", "0");
    const h = harness();
    const result = await startPlan({ free_windows: THURSDAY_EVENING }, h.deps);
    expect(result).toMatchObject({ ok: false, status: 429, code: "runs_paused" });
    expect(await h.repo.countCreatedSince(0)).toBe(0);
  });

  it("answers 503 and creates nothing when the room storage is not set up", async () => {
    const broken = {
      ...memoryRoomRepo(),
      countCreatedSince: async () => {
        throw new RoomStorageError("count", "relation does not exist");
      },
    };
    const h = harness({ repo: broken });
    const result = await startPlan({ free_windows: THURSDAY_EVENING }, h.deps);
    expect(result).toMatchObject({ ok: false, status: 503, code: "rooms_unavailable" });
    expect(h.scheduled).toHaveLength(0);
  });
});

describe("check_plan", () => {
  it("404s on an unknown plan id", async () => {
    const result = await checkPlan({ planId: "room_nope" }, harness().deps);
    expect(result).toMatchObject({ ok: false, status: 404, code: "no_such_plan" });
  });

  it("refuses a missing planId as bad input", async () => {
    expect(await checkPlan({}, harness().deps)).toMatchObject({ ok: false, status: 400 });
  });

  it("says negotiating at first, then awaiting_you with the agreed window, the messages, their policy stamps, and the draft", async () => {
    const h = harness();
    const { planId } = await start(h);
    const first = await checkPlan({ planId }, h.deps);
    expect(first.ok && first.value.state).toBe("negotiating");
    expect(first.ok && first.value.whatsapp_draft).toBeNull();

    await h.runScheduled();
    const later = await checkPlan({ planId }, h.deps);
    expect(later.ok).toBe(true);
    if (!later.ok) return;
    expect(later.value.state).toBe("awaiting_you");
    expect(later.value.agreed_window).toMatchObject({ start: "2026-10-29T19:00:00-05:00", end: "2026-10-29T21:00:00-05:00" });
    expect(later.value.agreed_window?.label).toContain("Thu");
    expect(later.value.messages.map((message) => message.seq)).toEqual([1, 2, 3]);
    expect(later.value.messages[0]).toMatchObject({ from: "Sprout", to: "Mochi", type: expect.any(String), policy: { shared: expect.any(Array), withheld: expect.any(Array), windows_dropped: expect.any(Number) } });
    expect(later.value.whatsapp_draft).toBe("Hey Mochi, ramen Thursday at 7? Want to go?");
    expect(later.value.whatsapp_link).toBe(`https://wa.me/?text=${encodeURIComponent("Hey Mochi, ramen Thursday at 7? Want to go?")}`);
    expect(later.value.decisions).toEqual({ you: "pending", mochi: "pending" });
  });

  it("calls a conversation that made no progress for minutes stalled", async () => {
    const h = harness({ negotiate: async () => {} });
    const { planId } = await start(h);
    await h.runScheduled();
    h.advance(5 * 60 * 1000);
    const result = await checkPlan({ planId }, h.deps);
    expect(result.ok && result.value.state).toBe("stalled");
  });

  it("stops serving a room after 2 hours, and the next plan started deletes it", async () => {
    const h = harness();
    const { planId } = await start(h);
    h.advance(ROOM_TTL_MS + 1000);
    expect(await checkPlan({ planId }, h.deps)).toMatchObject({ ok: false, status: 404 });
    expect(await h.repo.load(planId, NOW + ROOM_TTL_MS + 1000)).toBeNull();

    await startPlan({ free_windows: [{ day: "2026-10-30", start: "16:00", end: "19:00" }] }, { ...h.deps, now: () => NOW + ROOM_TTL_MS + 1000 });
    expect(await h.repo.countCreatedSince(0)).toBe(1);
  });
});

describe("respond", () => {
  it("accepting flips the plan: the person says yes, Mochi answers, the plan is confirmed, the room is saved", async () => {
    const h = harness();
    const { planId } = await start(h);
    await h.runScheduled();

    const result = await respond({ planId, decision: "accept" }, h.deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.you_answered).toBe("accepted");
    expect(result.value.state).toBe("confirmed");
    expect(result.value.decisions).toEqual({ you: "accepted", mochi: "accepted" });
    expect(result.value.whatsapp_link).toContain("wa.me");
    expect(h.mochiAnswers).toHaveLength(1);

    const saved = (await h.repo.load(planId, NOW)) as StateSnapshot;
    expect(saved.plans[0].state).toBe("confirmed");
  });

  it("declining drops the plan and Mochi is never asked", async () => {
    const h = harness();
    const { planId } = await start(h);
    await h.runScheduled();
    const result = await respond({ planId, decision: "decline" }, h.deps);
    expect(result.ok && result.value.state).toBe("dropped");
    expect(result.ok && result.value.you_answered).toBe("declined");
    expect(h.mochiAnswers).toHaveLength(0);
  });

  it("refuses to answer twice, before the agents agree, for an unknown plan, or with a bad decision", async () => {
    const h = harness();
    const { planId } = await start(h);
    expect(await respond({ planId, decision: "accept" }, h.deps)).toMatchObject({ ok: false, status: 409, code: "not_waiting_for_you" });
    await h.runScheduled();
    expect((await respond({ planId, decision: "accept" }, h.deps)).ok).toBe(true);
    expect(await respond({ planId, decision: "accept" }, h.deps)).toMatchObject({ ok: false, status: 409 });
    expect(await respond({ planId: "room_nope", decision: "accept" }, h.deps)).toMatchObject({ ok: false, status: 404 });
    expect(await respond({ planId, decision: "maybe" }, h.deps)).toMatchObject({ ok: false, status: 400 });
  });

  it("leaves Mochi's card pending when she cannot answer, and the next check_plan settles it", async () => {
    let healthy = false;
    const h = harness({
      mochi: async () => {
        if (!healthy) throw new Error("the model did not answer");
        return "accept";
      },
    });
    const { planId } = await start(h);
    await h.runScheduled();

    const first = await respond({ planId, decision: "accept" }, h.deps);
    expect(first.ok && first.value.state).toBe("waiting_for_mochi");
    expect(first.ok && first.value.decisions).toEqual({ you: "accepted", mochi: "pending" });

    healthy = true;
    const later = await checkPlan({ planId }, h.deps);
    expect(later.ok && later.value.state).toBe("confirmed");
  });
});

describe("the demo room is never touched", () => {
  it("leaves the demo store, and its file, exactly as it was through start, check, and respond", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "muse-byom-demo-"));
    vi.stubEnv("STORE", "json");
    vi.stubEnv("STORE_PATH", path.join(dir, "store.json"));
    const shared = globalThis as typeof globalThis & { __museStore?: unknown };
    delete shared.__museStore;
    const demo = await getStore();
    await demo.replaceAll(recordedSnapshot());
    const before = JSON.stringify(await demo.snapshot());
    const fileBefore = readFileSync(path.join(dir, "store.json"), "utf8");
    const mtimeBefore = statSync(path.join(dir, "store.json")).mtimeMs;

    const h = harness();
    const { planId } = await start(h);
    await h.runScheduled();
    await checkPlan({ planId }, h.deps);
    await respond({ planId, decision: "accept" }, h.deps);

    expect(JSON.stringify(await (await getStore()).snapshot())).toBe(before);
    expect(readFileSync(path.join(dir, "store.json"), "utf8")).toBe(fileBefore);
    expect(statSync(path.join(dir, "store.json")).mtimeMs).toBe(mtimeBefore);
    expect(readdirSync(dir)).toEqual(["store.json"]);
    delete shared.__museStore;
  });

  it("never mentions the demo store's factory, so a judge's room cannot reach it by mistake", () => {
    const root = path.join(process.cwd(), "app/api/connector");
    const files = [
      ...readdirSync(path.join(root, "_lib")).map((file) => path.join(root, "_lib", file)),
      path.join(root, "start_plan/route.ts"),
      path.join(root, "check_plan/route.ts"),
      path.join(root, "respond/route.ts"),
    ];
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/getStore/);
  });
});

describe("persistingStore", () => {
  it("saves the whole snapshot after writes, coalesces a burst, and ends with the latest state", async () => {
    const saved: StateSnapshot[] = [];
    const inner = new JsonStore(null);
    const { store, flush } = persistingStore(inner, async (snapshot) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      saved.push(snapshot);
    });
    for (let index = 0; index < 20; index += 1) {
      await store.addBusy({ agent: "aaron", event: { id: `busy_${index}`, title: "Busy", start: "2026-10-26T10:00:00-05:00", end: "2026-10-26T11:00:00-05:00", private: true } });
    }
    await flush();
    expect(saved.length).toBeGreaterThan(0);
    expect(saved.length).toBeLessThan(20);
    expect(saved.at(-1)!.busy).toHaveLength(20);
  });

  it("does not save for reads, and flush throws when the last save failed", async () => {
    let calls = 0;
    const { store, flush } = persistingStore(new JsonStore(null), async () => {
      calls += 1;
      throw new Error("disk full");
    });
    await store.getRoom();
    await store.snapshot();
    expect(calls).toBe(0);
    await store.setClock({ now: "2026-10-25T15:00:00-05:00" });
    await expect(flush()).rejects.toThrow("disk full");
  });
});
