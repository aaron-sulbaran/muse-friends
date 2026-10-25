import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPlan, respond, startPlan, type ByomDeps } from "@/app/api/connector/_lib/byom";
import { SLOT_PRESET_NAMES, SLOT_PRESETS, describePresets, presetWindows } from "@/app/api/connector/_lib/presets";
import { persistingStore } from "@/app/api/connector/_lib/room-store";
import { ROOM_TTL_MS, RoomStorageError, clearMemoryRooms, memoryRoomRepo } from "@/app/api/connector/_lib/rooms";
import { ownCalendar, ownFreeBlocks } from "@/lib/agent/calendar";
import { resetRunBudget } from "@/lib/agent/caps";
import { intersectWindows, toMs } from "@/lib/agent/windows";
import { transitionPlan } from "@/lib/plans";
import type { Plan, StateSnapshot } from "@/lib/protocol";
import { CALENDAR_RANGE, getPersona, rawShawarmaSignal, recordedSnapshot } from "@/lib/seed/fixtures";
import { getStore, type Store } from "@/lib/store";
import { JsonStore } from "@/lib/store/json";

// Sunday Oct 25, 3pm Central: the expo afternoon.
const NOW = Date.parse("2026-10-25T15:00:00-05:00");
const EVENINGS = { slots: "evenings" };

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

async function start(h: Harness, input: unknown = EVENINGS) {
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

describe("the slot presets", () => {
  const whole = (iso: string) => /T\d\d:00:00-05:00$/.test(iso);

  it("are exactly evenings, lunches and weekend", () => {
    expect([...SLOT_PRESET_NAMES]).toEqual(["evenings", "lunches", "weekend"]);
    expect(Object.keys(SLOT_PRESETS).sort()).toEqual(["evenings", "lunches", "weekend"]);
  });

  it("each give Sprout and Mochi at least an hour they both have free, so a plan always has something to agree on", () => {
    for (const name of SLOT_PRESET_NAMES) {
      const { sprout, mochi } = SLOT_PRESETS[name];
      expect(intersectWindows(sprout, mochi).length, name).toBeGreaterThan(0);
    }
  });

  it("are whole hours inside the demo calendar, at most 3 windows a person, none overlapping", () => {
    for (const name of SLOT_PRESET_NAMES) {
      for (const person of ["sprout", "mochi"] as const) {
        const windows = [...SLOT_PRESETS[name][person]].sort((a, b) => toMs(a.start) - toMs(b.start));
        expect(windows.length, `${name} ${person}`).toBeGreaterThanOrEqual(1);
        expect(windows.length, `${name} ${person}`).toBeLessThanOrEqual(3);
        for (const [index, window] of windows.entries()) {
          expect(whole(window.start) && whole(window.end), `${name} ${person} whole hours`).toBe(true);
          expect(toMs(window.start), name).toBeGreaterThanOrEqual(toMs(CALENDAR_RANGE.start));
          expect(toMs(window.end), name).toBeLessThanOrEqual(toMs(CALENDAR_RANGE.end));
          expect(toMs(window.end), name).toBeGreaterThan(toMs(window.start));
          if (index > 0) expect(toMs(window.start), name).toBeGreaterThanOrEqual(toMs(windows[index - 1].end));
        }
      }
    }
  });

  it("drop windows that have already ended, so a plan never starts from a calendar in the past", () => {
    expect(presetWindows("evenings", NOW).sprout).toHaveLength(3);
    expect(presetWindows("evenings", Date.parse("2026-10-28T12:00:00-05:00")).sprout).toHaveLength(2);
    expect(presetWindows("evenings", Date.parse("2026-11-02T12:00:00-05:00"))).toEqual({ sprout: [], mochi: [] });
  });

  it("read as plain words for the /connect page", () => {
    const described = describePresets();
    expect(described.map((preset) => preset.name)).toEqual(["evenings", "lunches", "weekend"]);
    expect(described[0].sprout[0]).toMatch(/^Tue /);
    expect(described[2].sprout.every((label) => label.startsWith("Sat "))).toBe(true);
  });
});

describe("start_plan", () => {
  it("takes only a preset name: anything else is refused as bad input and starts nothing", async () => {
    const h = harness();
    const refused = [{}, { slots: "mornings" }, { slots: 3 }, { slots: ["evenings"] }, { slots: null }, "evenings", null, [], { slots: "" }, { slots: "EVENINGS" }];
    for (const input of refused) {
      const result = await startPlan(input, h.deps);
      expect(result.ok, JSON.stringify(input)).toBe(false);
      expect(result.ok ? 0 : result.status, JSON.stringify(input)).toBe(400);
    }
    expect(h.scheduled).toHaveLength(0);
    expect(await h.repo.countCreatedSince(0)).toBe(0);
  });

  it("refuses free text and windows of the person's own, and does not echo them back", async () => {
    const h = harness();
    const secret = "dinner with my wife on our anniversary";
    const withHint = await startPlan({ slots: "evenings", reel_hint: secret }, h.deps);
    expect(withHint).toMatchObject({ ok: false, status: 400, code: "bad_input" });
    expect(withHint.ok ? "" : withHint.message).toContain("reel_hint");
    expect(withHint.ok ? "" : withHint.message).not.toContain("anniversary");

    const ownWindows = await startPlan({ slots: "evenings", free_windows: [{ day: "2026-10-29", start: "19:00", end: "21:00" }] }, h.deps);
    expect(ownWindows).toMatchObject({ ok: false, status: 400, code: "bad_input" });
    expect(ownWindows.ok ? "" : ownWindows.message).toContain("free_windows");

    const legacy = await startPlan({ free_windows: [{ day: "2026-10-29", start: "19:00", end: "21:00" }] }, h.deps);
    expect(legacy).toMatchObject({ ok: false, status: 400, code: "bad_input" });
    expect(h.scheduled).toHaveLength(0);
    expect(await h.repo.countCreatedSince(0)).toBe(0);
  });

  it("creates an isolated room for each preset, returns its key and how to check, and schedules the conversation", async () => {
    for (const name of SLOT_PRESET_NAMES) {
      const h = harness();
      const started = await start(h, { slots: name });
      expect(started.planId).toMatch(/^room_[A-Za-z0-9_-]{16}$/);
      expect(started.contextId).toMatch(/^ctx_/);
      expect(started.state).toBe("negotiating");
      expect(started.slots).toBe(name);
      expect(started.free_windows.map(({ start, end }) => ({ start, end }))).toEqual(presetWindows(name, NOW).sprout);
      expect(started.free_windows.every((window) => window.label.length > 0)).toBe(true);
      expect(started.how_to_check).toContain(started.planId);
      expect(started.how_to_check).toContain("check_plan");
      expect(started.expires_in_minutes).toBe(120);
      expect(h.scheduled).toHaveLength(1);

      const snapshot = (await h.repo.load(started.planId, NOW))!;
      expect(snapshot.room.simulatedFriend).toBe(true);
      expect(snapshot.plans).toHaveLength(1);
      expect(snapshot.plans[0].state).toBe("detected");
      expect(snapshot.signals[0].media.caption).toBe(rawShawarmaSignal().media.caption);
      expect(snapshot.clock.now).toBe("2026-10-25T15:00:00-05:00");
    }
  });

  it("makes both calendars exactly the preset's windows, not the seeded personas'", async () => {
    const h = harness();
    const started = await start(h, { slots: "lunches" });
    const store = new JsonStore(null);
    await store.replaceAll((await h.repo.load(started.planId, NOW))!);

    expect(await ownFreeBlocks(store, "aaron")).toEqual(SLOT_PRESETS.lunches.sprout);
    expect(await ownFreeBlocks(store, "lisa")).toEqual(SLOT_PRESETS.lunches.mochi);
    // Nothing of the personas' real calendars is in the room, only busy blocks around the preset windows.
    for (const agent of ["aaron", "lisa"] as const) {
      const titles = (await ownCalendar(store, agent)).map((event) => event.title);
      expect(new Set(titles)).toEqual(new Set(["Busy"]));
      for (const event of getPersona(agent).calendar) expect(titles).not.toContain(event.title);
    }
  });

  it("stores nothing about the person: one seeded signal, busy blocks, and nothing the caller sent", async () => {
    const h = harness();
    const started = await start(h, { slots: "weekend" });
    const snapshot = (await h.repo.load(started.planId, NOW))!;
    expect(snapshot.signals).toHaveLength(1);
    expect(snapshot.signals[0].media.caption).toBe(rawShawarmaSignal().media.caption);
    expect(new Set(snapshot.busy.map((block) => block.event.title))).toEqual(new Set(["Busy", "Calendar set by the room"]));
    expect(snapshot.messages).toHaveLength(0);
  });

  it("answers 422 slots_expired and starts nothing once the fictional week is over", async () => {
    const h = harness({ now: () => Date.parse("2026-11-02T12:00:00-05:00") });
    const result = await startPlan(EVENINGS, h.deps);
    expect(result).toMatchObject({ ok: false, status: 422, code: "slots_expired" });
    expect(h.scheduled).toHaveLength(0);
    expect(await h.repo.countCreatedSince(0)).toBe(0);
  });

  it("caps live rooms per hour across everyone, and the cap is counted in the repository", async () => {
    const h = harness({ maxRoomsPerHour: 2 });
    await start(h);
    await start(h);
    const third = await startPlan(EVENINGS, h.deps);
    expect(third.ok).toBe(false);
    if (third.ok) return;
    expect(third).toMatchObject({ status: 429, code: "room_cap", retryAfterSeconds: 300 });
    // An hour later the first two no longer count.
    h.advance(61 * 60 * 1000);
    expect((await startPlan({ slots: "lunches" }, h.deps)).ok).toBe(true);
  });

  it("stops when the app's hourly run budget is spent, and creates nothing", async () => {
    vi.stubEnv("MAX_LIVE_RUNS_PER_HOUR", "0");
    const h = harness();
    const result = await startPlan(EVENINGS, h.deps);
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
    const result = await startPlan(EVENINGS, h.deps);
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

    await startPlan({ slots: "weekend" }, { ...h.deps, now: () => NOW + ROOM_TTL_MS + 1000 });
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
