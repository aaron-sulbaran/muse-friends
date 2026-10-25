import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/availability/route";
import { GET } from "@/app/api/state/route";
import { ownCalendar, ownFreeBlocks } from "@/lib/agent/calendar";
import { recordCurrentRun } from "@/lib/agent/controls";
import { saveAvailability } from "@/lib/agent/availability";
import { injectSignal, runInboxTurn, runSignalTurn } from "@/lib/agent/runtime";
import { sendToFriend } from "@/lib/agent/outbox";
import { buildTools } from "@/lib/agent/tools";
import { localDeliver } from "@/lib/agent/wire";
import type { AgentRuntimeContext } from "@/lib/agent/context";
import type { AgentId, Window } from "@/lib/protocol";
import { getPersona, rawShawarmaSignal, seedSnapshot } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import { toUiSnapshot, forRole } from "@/lib/ui/snapshot";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";

// A person types the times they are free (and how they feel) and their Muse offers exactly those: the room sets that
// seat's whole calendar, the same way a judge's room does, and nothing seeded is left in it. A seat that typed nothing
// keeps its seeded calendar. The demo clock starts Sun Oct 25 at 2pm.

const TUE: Window = { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" };
const SAT: Window = { start: "2026-10-31T13:00:00-05:00", end: "2026-10-31T16:00:00-05:00" };
const WEEK = { start: "2026-10-25T00:00:00-05:00", end: "2026-11-01T00:00:00-05:00" };
const FEELS = "wiped from midterms, want something low key";
const food = { kind: "food", title: "Shawarma Point", place: "E 6th St" } as const;

let store: JsonStore;

beforeEach(async () => {
  store = new JsonStore(null);
  await store.replaceAll(seedSnapshot());
  (globalThis as { __museStore?: unknown }).__museStore = Promise.resolve(store);
});
afterEach(() => {
  (globalThis as { __museStore?: unknown }).__museStore = undefined;
  removeFakeModel();
  delete process.env.MODEL_RETRY_SCALE;
});

const post = (body: unknown) => POST(new Request("http://localhost:3001/api/availability", { method: "POST", body: JSON.stringify(body) }));
const typed = (agent: AgentId, windows: Window[], feels?: string) => saveAvailability(store, agent, { windows, feels }, "2026-10-25T14:00:00-05:00");
const toolsFor = (agent: AgentId) => buildTools({ agent, store, contextId: "ctx_x", windowRepairs: { used: 0 } }).handlers;
const calendarOf = async (agent: AgentId) => (await toolsFor(agent).get_my_calendar({ ...WEEK })) as { free: Window[]; busy: Array<{ title: string }> };
const messageOf = async (response: Response) => (await response.json()) as { ok: boolean; windows?: number; error: null | { message: string } };

describe("POST /api/availability", () => {
  it("keeps the typed times and answers with how many", async () => {
    const response = await post({ side: "a", windows: [TUE, SAT], feels: FEELS });
    expect(response.status).toBe(200);
    expect(await messageOf(response)).toEqual({ ok: true, windows: 2, error: null });
    expect((await store.getRoom()).availability?.aaron).toMatchObject({ windows: [TUE, SAT], feels: FEELS });
    expect((await store.getRoom()).availability?.lisa).toBeUndefined();
  });

  it("puts side b on Mochi's seat, and a second call for a side replaces the first", async () => {
    await post({ side: "b", windows: [TUE], feels: "tired" });
    await post({ side: "b", windows: [SAT] });
    expect((await store.getRoom()).availability?.lisa).toMatchObject({ windows: [SAT] });
    expect((await store.getRoom()).availability?.lisa?.feels).toBeUndefined();
    expect((await store.getRoom()).availability?.aaron).toBeUndefined();
  });

  it("merges times that overlap or touch, and counts what was kept", async () => {
    const response = await post({
      side: "a",
      windows: [
        { start: "2026-10-27T19:00:00-05:00", end: "2026-10-27T21:00:00-05:00" },
        { start: "2026-10-27T17:00:00-05:00", end: "2026-10-27T19:00:00-05:00" },
        SAT,
      ],
    });
    expect((await messageOf(response)).windows).toBe(2);
    expect((await store.getRoom()).availability?.aaron?.windows).toEqual([{ start: "2026-10-27T17:00:00-05:00", end: "2026-10-27T21:00:00-05:00" }, SAT]);
  });

  it("reads any offset and keeps the times in US Central", async () => {
    await post({ side: "a", windows: [{ start: "2026-10-27T23:00:00.000Z", end: "2026-10-28T01:00:00Z" }] });
    expect((await store.getRoom()).availability?.aaron?.windows).toEqual([TUE]);
  });

  it("turns the line into one line, and takes an empty one as none", async () => {
    await post({ side: "a", windows: [TUE], feels: "  wiped\nfrom   midterms\t " });
    expect((await store.getRoom()).availability?.aaron?.feels).toBe("wiped from midterms");
    await post({ side: "a", windows: [TUE], feels: "   " });
    expect((await store.getRoom()).availability?.aaron?.feels).toBeUndefined();
  });

  describe("refuses with a plain message and keeps the last good answer", () => {
    const cases: Array<[string, unknown, RegExp]> = [
      ["no side", { windows: [TUE] }, /side must be "a" or "b"/],
      ["a side that is neither", { side: "c", windows: [TUE] }, /side must be "a" or "b"/],
      ["windows that are not a list", { side: "a", windows: "Tuesday evening" }, /windows must be a list/],
      ["no windows", { side: "a", windows: [] }, /Add at least one time/],
      ["nine windows", { side: "a", windows: Array.from({ length: 9 }, (_, day) => ({ start: `2026-10-${26 + (day % 5)}T${10 + Math.floor(day / 5) * 3}:00:00-05:00`, end: `2026-10-${26 + (day % 5)}T${11 + Math.floor(day / 5) * 3}:00:00-05:00` })) }, /at most 8/],
      ["a time without an end", { side: "a", windows: [{ start: TUE.start }] }, /start and an end as ISO times/],
      ["a time that is not a time", { side: "a", windows: [{ start: "Tuesday 6pm", end: "Tuesday 8pm" }] }, /start and an end as ISO times/],
      ["an end before the start", { side: "a", windows: [{ start: TUE.end, end: TUE.start }] }, /has to end after it starts/],
      ["half an hour", { side: "a", windows: [{ start: TUE.start, end: "2026-10-27T18:30:00-05:00" }] }, /shorter than an hour/],
      ["a time already gone", { side: "a", windows: [{ start: "2026-10-25T10:00:00-05:00", end: "2026-10-25T12:00:00-05:00" }] }, /outside the days your Muse can see\. Pick times from Sun Oct 25, 2pm to Sat Oct 31, 10pm\./],
      ["a time past the week", { side: "a", windows: [{ start: "2026-11-01T10:00:00-05:00", end: "2026-11-01T12:00:00-05:00" }] }, /outside the days your Muse can see/],
      ["a time that runs past 10pm", { side: "a", windows: [{ start: "2026-10-27T21:00:00-05:00", end: "2026-10-27T23:00:00-05:00" }] }, /inside one day between 9am and 10pm/],
      ["a time that starts before 9am", { side: "a", windows: [{ start: "2026-10-27T08:00:00-05:00", end: "2026-10-27T10:00:00-05:00" }] }, /inside one day between 9am and 10pm/],
      ["a time across midnight", { side: "a", windows: [{ start: "2026-10-27T21:00:00-05:00", end: "2026-10-28T01:00:00-05:00" }] }, /inside one day between 9am and 10pm/],
      ["a line that is too long", { side: "a", windows: [TUE], feels: "x".repeat(121) }, /one line of 120 characters or fewer/],
      ["a key it does not know", { side: "a", windows: [TUE], free: true }, /Send \{ side/],
    ];
    it.each(cases)("%s", async (_name, body, message) => {
      await typed("aaron", [SAT]);
      const response = await post(body);
      expect(response.status).toBe(400);
      expect((await messageOf(response)).error?.message).toMatch(message);
      expect((await store.getRoom()).availability?.aaron?.windows).toEqual([SAT]);
    });

    it("a body that is not JSON", async () => {
      const response = await POST(new Request("http://localhost:3001/api/availability", { method: "POST", body: "not json" }));
      expect(response.status).toBe(400);
      expect((await messageOf(response)).error?.message).toMatch(/Send \{ side/);
    });
  });

  it("measures the days from the room's clock, not the wall's", async () => {
    await store.setClock({ now: "2026-10-28T09:00:00-05:00" });
    expect((await post({ side: "a", windows: [TUE] })).status).toBe(400);
    expect((await post({ side: "a", windows: [{ start: "2026-10-28T13:00:00-05:00", end: "2026-10-28T15:00:00-05:00" }] })).status).toBe(200);
  });
});

describe("the calendar a typed week sets", () => {
  it("is exactly the typed times: free is those and busy is everything else, with none of the seeded week left", async () => {
    await post({ side: "a", windows: [TUE, SAT] });
    expect((await calendarOf("aaron")).free).toEqual([TUE, SAT]);
    expect(await ownFreeBlocks(store, "aaron")).toEqual([TUE, SAT]);

    const busy = (await calendarOf("aaron")).busy;
    expect(busy.length).toBeGreaterThan(0);
    for (const block of busy) expect(block.title).toBe("Busy");
    const seeded = getPersona("aaron").calendar.map((event) => event.title);
    expect(JSON.stringify(await ownCalendar(store, "aaron"))).not.toMatch(new RegExp(seeded.join("|")));
  });

  it("covers the whole week with busy blocks around the typed times, so no gap is left free", async () => {
    await typed("aaron", [TUE, SAT]);
    const events = (await ownCalendar(store, "aaron")).map((event) => ({ start: Date.parse(event.start), end: Date.parse(event.end) })).sort((a, b) => a.start - b.start);
    expect(events[0].start).toBe(Date.parse(WEEK.start));
    expect(events.at(-1)!.end).toBe(Date.parse(WEEK.end));
    for (const [index, event] of events.slice(1).entries()) expect(event.start).toBeGreaterThanOrEqual(events[index].end);
    for (const window of [TUE, SAT]) expect(events.some((event) => event.start < Date.parse(window.end) && event.end > Date.parse(window.start))).toBe(false);
  });

  it("only changes the seat that typed: the other keeps its seeded week", async () => {
    await typed("aaron", [TUE]);
    expect(await ownCalendar(store, "lisa")).toEqual(getPersona("lisa").calendar);
    expect(await ownFreeBlocks(store, "lisa")).not.toEqual([TUE]);
  });

  it("leaves a seat that typed nothing exactly as it was seeded, busy blocks from the controls included", async () => {
    expect(await ownCalendar(store, "aaron")).toEqual(getPersona("aaron").calendar);
    const added = { id: "busy_1", title: "Dentist", start: "2026-10-28T15:00:00-05:00", end: "2026-10-28T16:00:00-05:00", private: false };
    await store.addBusy({ agent: "aaron", event: added });
    expect(await ownCalendar(store, "aaron")).toEqual([...getPersona("aaron").calendar, added]);
  });

  it("still lets the controls block a time inside a typed window", async () => {
    await typed("aaron", [{ start: "2026-10-27T17:00:00-05:00", end: "2026-10-27T21:00:00-05:00" }]);
    await store.addBusy({ agent: "aaron", event: { id: "busy_2", title: "Busy", start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T19:00:00-05:00", private: true } });
    expect(await ownFreeBlocks(store, "aaron")).toEqual([
      { start: "2026-10-27T17:00:00-05:00", end: "2026-10-27T18:00:00-05:00" },
      { start: "2026-10-27T19:00:00-05:00", end: "2026-10-27T21:00:00-05:00" },
    ]);
  });

  it("stops offering a typed time once the clock has passed it", async () => {
    await typed("aaron", [TUE, SAT]);
    await store.setClock({ now: "2026-10-28T09:00:00-05:00" });
    expect(await ownFreeBlocks(store, "aaron")).toEqual([SAT]);
  });

  it("a Reset puts the seeded week back", async () => {
    await typed("aaron", [TUE], FEELS);
    const { resetDemo } = await import("@/lib/agent/controls");
    await resetDemo(store);
    expect((await store.getRoom()).availability).toBeUndefined();
    expect(await ownCalendar(store, "aaron")).toEqual(getPersona("aaron").calendar);
  });
});

describe("the line about how they feel", () => {
  it("is read through get_interests, with the rest of their interests, for that seat only", async () => {
    await typed("aaron", [TUE], FEELS);
    expect(await toolsFor("aaron").get_interests({})).toEqual({ ...getPersona("aaron").interests, feels: FEELS });
    expect(await toolsFor("aaron").get_interests({ category: "interests" })).toEqual({ interests: getPersona("aaron").interests.interests, feels: FEELS });
    expect(await toolsFor("aaron").get_interests({ category: "food" })).toEqual({ food: getPersona("aaron").interests.food });
    expect(await toolsFor("lisa").get_interests({})).toEqual(getPersona("lisa").interests);
  });

  it("is not there when there is no line, or no typed week at all", async () => {
    expect(await toolsFor("aaron").get_interests({})).toEqual(getPersona("aaron").interests);
    await typed("aaron", [TUE]);
    expect(await toolsFor("aaron").get_interests({})).toEqual(getPersona("aaron").interests);
  });

  describe("reaches the friend's Muse only through the sharing settings", () => {
    let contextId: string;
    let clock: number;
    const sendNote = (note: string) => {
      clock += 5000;
      const ctx: AgentRuntimeContext = { agent: "aaron", store, contextId, signalId: rawShawarmaSignal().id, wallNow: () => clock, windowRepairs: { used: 0 } };
      return sendToFriend(ctx, { friend: "lisa", type: "intent", reason: "interest_match", activity: food, windows: [TUE], note });
    };

    beforeEach(async () => {
      clock = Date.parse("2026-10-24T20:00:00-05:00");
      ({ contextId } = await injectSignal(store, rawShawarmaSignal(), () => clock));
      await typed("aaron", [TUE], FEELS);
    });

    it("takes the line out of a note when interests are off, and says so", async () => {
      await store.putPolicy({ owner: "aaron", friend: "lisa", tier: "friend", categories: { interests: false } });
      expect(await sendNote(`Sounds good. Honestly I am ${FEELS}.`)).toMatchObject({ ok: true });
      const [record] = await store.listMessages(contextId);
      expect(record.message.note).toBeUndefined();
      expect(record.stamp.removed).toContain("interests");
      expect(JSON.stringify(record)).not.toContain("midterms");
    });

    it("lets it through when interests are shared", async () => {
      await store.putPolicy({ owner: "aaron", friend: "lisa", tier: "friend", categories: { interests: true } });
      expect(await sendNote(`Sounds good. Honestly I am ${FEELS}.`)).toMatchObject({ ok: true });
      const [record] = await store.listMessages(contextId);
      expect(record.message.note).toContain("midterms");
      expect(record.stamp.removed).not.toContain("interests");
    });

    it("is never sent as data on its own: shared interests are the seeded ones, short", async () => {
      await store.putPolicy({ owner: "aaron", friend: "lisa", tier: "friend", categories: { interests: true } });
      clock += 5000;
      const ctx: AgentRuntimeContext = { agent: "aaron", store, contextId, signalId: rawShawarmaSignal().id, wallNow: () => clock, windowRepairs: { used: 0 } };
      expect(await sendToFriend(ctx, { friend: "lisa", type: "intent", reason: "interest_match", activity: food, windows: [TUE], share: ["interests"] })).toMatchObject({ ok: true });
      const [record] = await store.listMessages(contextId);
      expect(record.message.shared?.interests).toEqual(getPersona("aaron").interests.interests?.slice(0, 5));
      expect(JSON.stringify(record)).not.toContain("midterms");
    });
  });
});

describe("what the Muses can offer", () => {
  it("refuses to offer a time the person did not type", async () => {
    await typed("aaron", [SAT]);
    const clock = Date.parse("2026-10-24T20:00:00-05:00");
    const { contextId } = await injectSignal(store, rawShawarmaSignal(), () => clock);
    const ctx: AgentRuntimeContext = { agent: "aaron", store, contextId, signalId: rawShawarmaSignal().id, wallNow: () => clock + 5000, windowRepairs: { used: 0 } };
    // Tuesday evening is free on Aaron's seeded week, and no longer free on the week he typed.
    const result = await sendToFriend(ctx, { friend: "lisa", type: "intent", reason: "interest_match", activity: food, windows: [TUE] });
    expect(result).toMatchObject({ error: expect.any(String) });
    expect(await store.listMessages()).toEqual([]);
  });

  it("drops with the honest reason when the two typed weeks do not meet", async () => {
    process.env.MODEL_RETRY_SCALE = "0";
    installFakeModel(Array.from({ length: 80 }, () => ({ error: 404, code: "model_not_found" })));
    await typed("aaron", [TUE]);
    await typed("lisa", [SAT]);
    let clock = Date.parse("2026-10-24T20:00:00-05:00");
    const wallNow = () => (clock += 3000);
    const { contextId } = await injectSignal(store, rawShawarmaSignal(), wallNow);
    await runSignalTurn({ store, agent: "aaron", signalId: rawShawarmaSignal().id, contextId, wallNow, deliver: localDeliver(store, "aaron") });
    for (const agent of ["lisa", "aaron", "lisa", "aaron"] as const) {
      if ((await store.getPlanByContext(contextId))?.state === "dropped") break;
      await runInboxTurn({ store, agent, contextId, wallNow, deliver: localDeliver(store, agent) });
    }
    expect(await store.getPlanByContext(contextId)).toMatchObject({ state: "dropped", dropReason: "no_overlap" });
    const ui = toUiSnapshot(await store.snapshot(), { mode: "live" });
    expect(JSON.stringify(ui)).toContain("No shared free time");
  });

  it("finds the time when the typed weeks do meet", async () => {
    process.env.MODEL_RETRY_SCALE = "0";
    installFakeModel(Array.from({ length: 80 }, () => ({ error: 404, code: "model_not_found" })));
    await typed("aaron", [TUE, SAT]);
    await typed("lisa", [SAT]);
    let clock = Date.parse("2026-10-24T20:00:00-05:00");
    const wallNow = () => (clock += 3000);
    const { contextId } = await injectSignal(store, rawShawarmaSignal(), wallNow);
    await runSignalTurn({ store, agent: "aaron", signalId: rawShawarmaSignal().id, contextId, wallNow, deliver: localDeliver(store, "aaron") });
    for (const agent of ["lisa", "aaron"] as const) await runInboxTurn({ store, agent, contextId, wallNow, deliver: localDeliver(store, agent) });
    const plan = await store.getPlanByContext(contextId);
    expect(plan).toMatchObject({ state: "awaiting_humans" });
    expect(plan?.window).toEqual(SAT);
  });
});

describe("the snapshot", () => {
  const ui = async () => toUiSnapshot(await store.snapshot(), { mode: "live" });

  it("has no typedAvailability until someone types", async () => {
    expect(await ui()).not.toHaveProperty("typedAvailability");
  });

  it("shows each seat's times, soonest first, with the line, and nothing else of the stored entry", async () => {
    await typed("aaron", [SAT, TUE], FEELS);
    await typed("lisa", [SAT]);
    const snapshot = await ui();
    expect(snapshot.typedAvailability).toEqual({ aaron: { windows: [TUE, SAT], feels: FEELS }, lisa: { windows: [SAT] } });
  });

  it("gives the stage both seats, a phone only its own, and an unknown role neither", async () => {
    await typed("aaron", [TUE], FEELS);
    await typed("lisa", [SAT], "ready for anything");
    const snapshot = await ui();
    expect(forRole(snapshot, null).typedAvailability).toEqual(snapshot.typedAvailability);
    expect(forRole(snapshot, "a").typedAvailability).toEqual({ aaron: { windows: [TUE], feels: FEELS } });
    expect(forRole(snapshot, "b").typedAvailability).toEqual({ lisa: { windows: [SAT], feels: "ready for anything" } });
    expect(forRole(snapshot, "c")).not.toHaveProperty("typedAvailability");
    expect(JSON.stringify(forRole(snapshot, "a"))).not.toContain("ready for anything");
    expect(JSON.stringify(forRole(snapshot, "b"))).not.toContain("midterms");
  });

  it("drops the whole field for a role when its own seat typed nothing", async () => {
    await typed("aaron", [TUE], FEELS);
    expect(forRole(await ui(), "b")).not.toHaveProperty("typedAvailability");
  });

  it("comes through /api/state with a view of its own for each role", async () => {
    await typed("aaron", [TUE], FEELS);
    await typed("lisa", [SAT], "ready for anything");
    const fetchState = (query: string) => GET(new Request(`http://localhost:3001/api/state${query}`));
    const stage = await fetchState("");
    const sideA = await fetchState("?role=a");
    const sideB = await fetchState("?role=b");
    const bodies = { stage: await stage.json(), a: await sideA.json(), b: await sideB.json() };
    expect(Object.keys(bodies.stage.typedAvailability)).toEqual(["aaron", "lisa"]);
    expect(Object.keys(bodies.a.typedAvailability)).toEqual(["aaron"]);
    expect(Object.keys(bodies.b.typedAvailability)).toEqual(["lisa"]);
    const tags = [stage, sideA, sideB].map((response) => response.headers.get("etag"));
    expect(new Set(tags).size).toBe(3);
  });

  it("is not baked into a recorded run that everyone can replay", async () => {
    await typed("aaron", [TUE], FEELS);
    const run = await recordCurrentRun(store, { id: "run_typed", label: "with a typed week" });
    expect(JSON.stringify(run)).not.toContain("midterms");
    expect(run.snapshot.room.availability).toBeUndefined();
    expect((await store.getRoom()).availability?.aaron).toBeDefined();
  });
});
