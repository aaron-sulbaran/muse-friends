import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { activityFromSignal, fallbackWindows } from "@/lib/agent/fallback";
import { injectSignal, runInboxTurn, runSignalTurn } from "@/lib/agent/runtime";
import { localDeliver } from "@/lib/agent/wire";
import { CALENDAR_RANGE } from "@/lib/seed/personas";
import { PRIVATE_STRINGS, rawShawarmaSignal } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";

// The scripted fallback turn: when the model cannot produce a message, the agent still answers, in code.

let store: JsonStore;
let contextId: string;
let clock: number;
const SIGNAL_ID = rawShawarmaSignal().id;
const wallNow = () => (clock += 3000);
const down = (times = 60) => installFakeModel(Array.from({ length: times }, () => ({ error: 404, code: "model_not_found" })));

beforeEach(async () => {
  process.env.MODEL_RETRY_SCALE = "0";
  store = new JsonStore(null);
  clock = Date.parse("2026-10-24T20:00:00-05:00");
  ({ contextId } = await injectSignal(store, rawShawarmaSignal(), () => clock));
});
afterEach(() => {
  removeFakeModel();
  delete process.env.MODEL_RETRY_SCALE;
});

const open = () => runSignalTurn({ store, agent: "aaron", signalId: SIGNAL_ID, contextId, wallNow, deliver: localDeliver(store, "aaron") });
const reply = (agent: "aaron" | "lisa") => runInboxTurn({ store, agent, contextId, wallNow, deliver: localDeliver(store, agent) });

describe("the retry path", () => {
  it("a model that answers 404 eight times and then replies never reaches the fallback", async () => {
    installFakeModel([
      ...Array.from({ length: 8 }, () => ({ error: 404, code: "model_not_found" })),
      { calls: [{ name: "read_signal", args: {} }] },
      { calls: [{ name: "get_my_calendar", args: { start: "2026-10-26", end: "2026-11-01" } }] },
      {
        calls: [
          {
            name: "send_to_friend_agent",
            args: { friend: "lisa", type: "intent", reason: "interest_match", activity: { kind: "food", title: "Shawarma Point" }, windows: [{ start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" }] },
          },
        ],
      },
    ]);
    const result = await open();
    expect(result.status).toBe("completed");
    expect(result.fallback).toBeUndefined();
    const [record] = await store.listMessages();
    expect(record.proof).toBeDefined();
    expect((await store.listEvents()).filter((event) => event.text.startsWith("Fallback"))).toHaveLength(0);
  });
});

describe("the fallback path", () => {
  it("opens the conversation from the agent's own free windows when the model is down", async () => {
    down();
    const result = await open();
    expect(result).toMatchObject({ status: "completed", fallback: true, failure: { detail: "api_error" } });

    const [record] = await store.listMessages();
    expect(record.message).toMatchObject({ from: "aaron", to: "lisa", type: "intent", reason: "interest_match", activity: { kind: "food", title: "Shawarma Point" } });
    expect(record.message.note).toBe("Want to go? Here are times I am free.");
    expect(record.proof).toBeUndefined();
    expect(record.message.windows!.length).toBeGreaterThan(0);
    expect(record.message.windows!.length).toBeLessThanOrEqual(3);
    for (const window of record.message.windows!) expect(Date.parse(window.end) - Date.parse(window.start)).toBeLessThanOrEqual(3 * 3_600_000);

    expect(await store.getPlanByContext(contextId)).toMatchObject({ state: "negotiating" });
    const events = await store.listEvents();
    const marker = events.find((event) => event.text.startsWith("Fallback"));
    expect(marker).toMatchObject({ kind: "plan_state", agent: "aaron", messageId: record.message.id, text: "Fallback: the model could not reply, so Sprout sent its free windows" });
    expect(events.some((event) => event.kind === "turn_failed")).toBe(false);
  });

  it("reaches awaiting_humans with the model down for both agents", async () => {
    down();
    await open();
    await reply("lisa");
    await reply("aaron");

    const messages = (await store.listMessages()).map((record) => record.message);
    expect(messages.map((message) => [message.from, message.type])).toEqual([
      ["aaron", "intent"],
      ["lisa", "accept"],
      ["aaron", "accept"],
    ]);
    expect(await store.getThread(contextId)).toMatchObject({ state: "input-required", messageCount: 3 });
    const plan = await store.getPlanByContext(contextId);
    expect(plan).toMatchObject({ state: "awaiting_humans", activity: { title: "Shawarma Point" } });
    expect(plan?.window).toBeDefined();
    expect(await store.listCards({ planId: plan!.id })).toHaveLength(2);

    const markers = (await store.listEvents()).filter((event) => event.text.startsWith("Fallback"));
    expect(markers.map((event) => event.agent)).toEqual(["aaron", "lisa", "aaron"]);
    expect(markers.map((event) => event.text.split("sent ")[1])).toEqual(["its free windows", expect.stringMatching(/^an accept of /), expect.stringMatching(/^an accept of /)]);
  });

  it("counters with its own free windows when nothing offered fits, and the other side can still close", async () => {
    // Mochi is busy on every window Sprout offered, so the fallback answers with her own free time.
    await store.addBusy({ agent: "lisa", event: { id: "b-all", title: "Away", start: CALENDAR_RANGE.start, end: "2026-10-28T06:00:00-05:00", private: true } });
    down();
    await open();
    await reply("lisa");
    const messages = (await store.listMessages()).map((record) => record.message);
    const counter = messages.find((message) => message.from === "lisa");
    expect(counter).toMatchObject({ type: "counter", reason: "no_overlap" });
    expect(counter?.windows?.length).toBeGreaterThan(0);
    const offered = messages[0].windows!.map((window) => window.start);
    for (const window of counter!.windows!) expect(offered).not.toContain(window.start);
  });

  it("never delivers a private string, since the fallback's wording is fixed", async () => {
    down();
    await open();
    await reply("lisa");
    const delivered = JSON.stringify((await store.listMessages()).map((record) => record.message));
    for (const secrets of Object.values(PRIVATE_STRINGS)) for (const secret of secrets) expect(delivered).not.toContain(secret);
  });

  it("respects the share policy like any message: location withheld when the person turned it off", async () => {
    await store.putPolicy({ owner: "aaron", friend: "lisa", tier: "close", categories: { location: false } });
    down();
    await open();
    const [record] = await store.listMessages();
    expect(record.message.activity?.place).toBeUndefined();
    expect(record.stamp.removed).toEqual(["location"]);
  });

  it("falls back after the nudge gets no tool call, not only on an API error", async () => {
    installFakeModel([{ text: "Sounds fun" }, { text: "Really" }]);
    const result = await open();
    expect(result).toMatchObject({ status: "completed", fallback: true, failure: { detail: "no_tool_call" } });
  });
});

describe("honest drop reasons", () => {
  it("drops with no_overlap, not the cap, when the agent has no free window at all", async () => {
    await store.addBusy({ agent: "aaron", event: { id: "b-everything", title: "Away", start: CALENDAR_RANGE.start, end: CALENDAR_RANGE.end, private: true } });
    down();
    const result = await open();
    expect(result.status).toBe("failed");
    expect(await store.getPlanByContext(contextId)).toMatchObject({ state: "dropped", dropReason: "no_overlap" });
    expect(await store.listMessages()).toHaveLength(0);
    expect((await store.listEvents()).at(-1)).toMatchObject({ kind: "turn_failed" });
    expect((await store.listEvents()).at(-1)?.text).toContain("no_overlap");
  });

  it("declines with no_overlap when the answering agent has nothing to offer", async () => {
    down();
    await open();
    await store.addBusy({ agent: "lisa", event: { id: "b-everything", title: "Away", start: CALENDAR_RANGE.start, end: CALENDAR_RANGE.end, private: true } });
    await reply("lisa");
    const last = (await store.listMessages()).at(-1)!.message;
    expect(last).toMatchObject({ from: "lisa", type: "decline", reason: "no_overlap" });
    expect(await store.getPlanByContext(contextId)).toMatchObject({ state: "dropped", dropReason: "no_overlap" });
  });

  it("says an agent could not reply, not that the cap was reached, when even the fallback cannot send", async () => {
    down();
    const result = await runSignalTurn({ store, agent: "aaron", signalId: SIGNAL_ID, contextId, wallNow, deliver: async () => ({ ok: false, status: 503, error: "inbox down" }) });
    expect(result.status).toBe("failed");
    expect(await store.getPlanByContext(contextId)).toMatchObject({ state: "dropped", dropReason: "agent_unavailable" });
  });
});

describe("what the fallback reads from the world", () => {
  it("offers at most three windows, one a day, evenings first, each at most three hours", () => {
    const free = [
      { start: "2026-10-26T09:00:00-05:00", end: "2026-10-26T22:00:00-05:00" },
      { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T22:00:00-05:00" },
      { start: "2026-10-28T08:00:00-05:00", end: "2026-10-28T10:00:00-05:00" },
      { start: "2026-10-29T17:00:00-05:00", end: "2026-10-29T19:00:00-05:00" },
      { start: "2026-10-30T17:00:00-05:00", end: "2026-10-30T19:00:00-05:00" },
    ];
    const windows = fallbackWindows(free);
    expect(windows).toEqual([
      { start: "2026-10-26T17:00:00-05:00", end: "2026-10-26T20:00:00-05:00" },
      { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T21:00:00-05:00" },
      { start: "2026-10-29T17:00:00-05:00", end: "2026-10-29T19:00:00-05:00" },
    ]);
  });

  it("uses a daytime stretch when there is no evening, and nothing when there is no free hour", () => {
    expect(fallbackWindows([{ start: "2026-10-26T09:00:00-05:00", end: "2026-10-26T11:00:00-05:00" }])).toEqual([{ start: "2026-10-26T09:00:00-05:00", end: "2026-10-26T11:00:00-05:00" }]);
    expect(fallbackWindows([{ start: "2026-10-26T09:00:00-05:00", end: "2026-10-26T09:30:00-05:00" }])).toEqual([]);
  });

  it("skips windows already passed over in the thread", () => {
    const free = [{ start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T21:00:00-05:00" }];
    expect(fallbackWindows(free, new Set(["x"]))).toHaveLength(1);
  });

  it("reads the place and the area from the caption, and says 'this spot' when it cannot", () => {
    expect(activityFromSignal(rawShawarmaSignal())).toEqual({ kind: "food", title: "Shawarma Point", place: "E 6th St" });
    const odd = { ...rawShawarmaSignal(), media: { ...rawShawarmaSignal().media, caption: "wow 😍 so good" } };
    expect(activityFromSignal(odd)).toEqual({ kind: "food", title: "this spot" });
    expect(activityFromSignal({ ...rawShawarmaSignal(), extracted: { source: "caption_model", place: "Moonlight Noodles", area: "South Congress", at: "2026-10-25T14:00:00-05:00" } })).toEqual({
      kind: "food",
      title: "Moonlight Noodles",
      place: "South Congress",
    });
  });
});
