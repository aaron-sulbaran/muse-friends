import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentRuntimeContext } from "@/lib/agent/context";
import { injectSignal, runSignalTurn } from "@/lib/agent/runtime";
import { buildTools } from "@/lib/agent/tools";
import { agentInstructions, signalTurnInput } from "@/lib/agent/prompts";
import { rawShawarmaSignal } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";

const TUE = { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" };

let store: JsonStore;
let contextId: string;
let clock: number;
const SIGNAL_ID = rawShawarmaSignal().id;

beforeEach(async () => {
  store = new JsonStore(null);
  clock = Date.parse("2026-10-24T20:00:00-05:00");
  ({ contextId } = await injectSignal(store, rawShawarmaSignal(), () => clock));
});
afterEach(removeFakeModel);

function toolsFor(agent: "aaron" | "lisa", overrides: Partial<AgentRuntimeContext> = {}) {
  return buildTools({ agent, store, contextId, signalId: SIGNAL_ID, wallNow: () => clock, windowRepairs: { used: 0 }, ...overrides });
}

describe("injectSignal", () => {
  it("stores the signal, opens a plan in detected, and logs the human event", async () => {
    expect(await store.getSignal(SIGNAL_ID)).toMatchObject({ from: "lisa", to: "aaron" });
    expect(await store.getPlanByContext(contextId)).toMatchObject({ state: "detected", initiator: "aaron" });
    expect(await store.getThread(contextId)).toBeNull();
    expect((await store.listEvents())[0]).toMatchObject({ kind: "signal_received", actor: "human", text: 'Mochi shared a reel with Sprout: "we should go!!"' });
  });
});

describe("tools", () => {
  it("get_my_calendar returns free and busy blocks from the demo clock onward, in the owner's view", async () => {
    const { handlers } = toolsFor("aaron");
    const result = (await handlers.get_my_calendar({ start: "2026-10-25T00:00:00-05:00", end: "2026-10-28T00:00:00-05:00" })) as {
      free: Array<{ start: string; end: string }>;
      busy: Array<{ title: string; private: boolean }>;
      now: string;
    };
    expect(result.now).toBe("2026-10-25T14:00:00-05:00");
    expect(result.free).toContainEqual({ start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T22:00:00-05:00" });
    expect(result.free.every((block) => Date.parse(block.start) >= Date.parse(result.now))).toBe(true);
    expect(result.busy.find((event) => event.title === "Interview, Northwind Labs")).toMatchObject({ private: true });
  });

  it("get_my_calendar reads times without an offset as Central and rejects nonsense", async () => {
    const { handlers } = toolsFor("lisa");
    const ok = (await handlers.get_my_calendar({ start: "2026-10-27", end: "2026-10-28" })) as { free: unknown[] };
    expect(ok.free).toContainEqual({ start: "2026-10-27T17:00:00-05:00", end: "2026-10-27T20:00:00-05:00" });
    expect(await handlers.get_my_calendar({ start: "later", end: "2026-10-28" })).toMatchObject({ error: expect.stringContaining("ISO 8601") });
    expect(await handlers.get_my_calendar({ start: "2026-10-28", end: "2026-10-27" })).toMatchObject({ error: expect.any(String) });
    expect(await handlers.get_my_calendar({ start: "2026-10-27" })).toMatchObject({ error: expect.stringContaining("Invalid arguments") });
  });

  it("get_my_calendar includes busy blocks a judge added", async () => {
    await store.addBusy({ agent: "aaron", event: { id: "b1", title: "Dentist", start: TUE.start, end: TUE.end, private: true } });
    const { handlers } = toolsFor("aaron");
    const result = (await handlers.get_my_calendar({ start: "2026-10-27", end: "2026-10-28" })) as { free: Array<{ start: string }>; busy: Array<{ title: string }> };
    expect(result.busy.map((event) => event.title)).toContain("Dentist");
    expect(result.free.some((block) => block.start === TUE.start)).toBe(false);
  });

  it("get_interests returns only the caller's own interests", async () => {
    expect(await toolsFor("aaron").handlers.get_interests({ category: "food" })).toEqual({ food: ["shawarma", "ramen", "breakfast tacos"] });
    expect(await toolsFor("lisa").handlers.get_interests({})).toMatchObject({ food: expect.arrayContaining(["dumplings"]) });
    expect(await toolsFor("aaron").handlers.get_interests({ category: "availability" })).toMatchObject({ error: expect.any(String) });
  });

  it("read_signal shows the reel to its recipient only", async () => {
    expect(await toolsFor("aaron").handlers.read_signal({})).toMatchObject({
      from: "Mochi",
      message: "we should go!!",
      reel: { caption: expect.stringContaining("Shawarma Point") },
    });
    expect(await toolsFor("lisa").handlers.read_signal({})).toMatchObject({ error: expect.any(String) });
  });

  it("record_reel_details saves the extraction as caption_model output and logs it", async () => {
    const { handlers } = toolsFor("aaron");
    expect(await handlers.record_reel_details({ place: "Shawarma Point", area: "E 6th St", hours: "Open until 9, closed Sundays" })).toMatchObject({ ok: true });
    expect((await store.getSignal(SIGNAL_ID))?.extracted).toMatchObject({ source: "caption_model", model: "muse-spark-1.3", place: "Shawarma Point" });
    const event = (await store.listEvents()).find((row) => row.kind === "caption_extracted");
    expect(event?.text).toContain("Shawarma Point");
    expect(event?.text).toContain("(extracted from caption)");
    expect(await handlers.record_reel_details({})).toMatchObject({ error: expect.stringContaining("Invalid arguments") });
  });

  it("send_to_friend_agent exposes a strict JSON schema for the model-authored message only", () => {
    const send = toolsFor("aaron").tools.find((tool) => tool.name === "send_to_friend_agent")!;
    const schema = send.parameters as { additionalProperties?: boolean; properties: Record<string, unknown>; required: string[] };
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual(["activity", "friend", "note", "reason", "share", "type", "windows"]);
    expect(schema).not.toHaveProperty("$schema");
  });

  it("offers the model exactly the five tools", () => {
    expect(toolsFor("aaron").tools.map((tool) => tool.name)).toEqual([
      "get_my_calendar",
      "get_interests",
      "read_signal",
      "record_reel_details",
      "send_to_friend_agent",
    ]);
  });
});

describe("prompts", () => {
  it("are static per agent, name the friend with its id, and keep private details out of notes", () => {
    const instructions = agentInstructions("aaron");
    expect(instructions).toContain("You are Sprout");
    expect(instructions).toContain('friend: "lisa"');
    expect(instructions).toContain("Never put private details in a note");
    expect(instructions).toContain('share: ["location"]');
    expect(agentInstructions("aaron")).toBe(instructions);
    expect(agentInstructions("lisa")).toContain("You are Mochi");
  });

  it("tell the signal turn the date and the steps, without leaking the caption", () => {
    const input = signalTurnInput("aaron", SIGNAL_ID, Date.parse("2026-10-25T14:00:00-05:00"));
    expect(input).toContain("Sun Oct 25, 2pm");
    expect(input).toContain("read_signal");
    expect(input).not.toContain("garlic");
  });
});

describe("runSignalTurn with a scripted model", () => {
  const detailsCall = { name: "record_reel_details", args: { place: "Shawarma Point", area: "E 6th St", hours: "Open until 9" } };
  const calendarCall = { name: "get_my_calendar", args: { start: "2026-10-26", end: "2026-11-01" } };
  const sendCall = (args: Record<string, unknown>) => ({
    name: "send_to_friend_agent",
    args: { friend: "lisa", type: "intent", reason: "interest_match", activity: { kind: "food", title: "Shawarma Point", place: "E 6th St" }, windows: [TUE], note: "Want to go this week?", ...args },
  });

  it("reads the reel, extracts it, checks the calendar, and opens the thread with one message", async () => {
    const fake = installFakeModel([
      { calls: [{ name: "read_signal", args: {} }] },
      { calls: [detailsCall, calendarCall] },
      { calls: [sendCall({})] },
    ]);
    const result = await runSignalTurn({ store, agent: "aaron", signalId: SIGNAL_ID, contextId, wallNow: () => clock });

    expect(result.status).toBe("completed");
    expect(result.toolCalls.map((call) => call.name)).toEqual(["read_signal", "record_reel_details", "get_my_calendar", "send_to_friend_agent"]);
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[0].instructions).toContain("You are Sprout");

    const snapshot = await store.snapshot();
    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.messages[0].message).toMatchObject({ from: "aaron", type: "intent", windows: [TUE] });
    expect(snapshot.signals[0].extracted?.source).toBe("caption_model");
    expect(snapshot.plans[0].state).toBe("negotiating");
    expect(snapshot.events.map((event) => event.kind)).toEqual(["signal_received", "caption_extracted", "thread_opened", "message_sent"]);
  });

  it("records each tool call on the message proof, one line each, ending with the send, and no private title", async () => {
    installFakeModel([
      { calls: [{ name: "read_signal", args: {} }] },
      { calls: [detailsCall, calendarCall] },
      { calls: [sendCall({})] },
    ]);
    await runSignalTurn({ store, agent: "aaron", signalId: SIGNAL_ID, contextId, wallNow: () => clock });
    const [record] = await store.listMessages();
    const calls = record.proof!.toolCalls!;
    expect(calls.map((call) => call.name)).toEqual(["read_signal", "record_reel_details", "get_my_calendar", "send_to_friend_agent"]);
    expect(calls[0]).toEqual({ name: "read_signal", args: "", result: "reel from Mochi" });
    expect(calls[1]).toEqual({ name: "record_reel_details", args: "place Shawarma Point, E 6th St", result: "saved" });
    expect(calls[2]).toMatchObject({ args: "2026-10-26 to 2026-11-01", result: expect.stringMatching(/^\d+ free blocks?, \d+ busy$/) });
    expect(calls[3]).toEqual({ name: "send_to_friend_agent", args: "intent, 1 window", result: "message #1 working" });
    expect(JSON.stringify(record.proof)).not.toMatch(/Northwind|Interview|garlic/);
    for (const call of calls) expect(`${call.args}${call.result}`).not.toMatch(/\n/);
  });

  it("lets the model repair one bad send within the 6 call cap", async () => {
    installFakeModel([
      { calls: [{ name: "read_signal", args: {} }, detailsCall, calendarCall] },
      { calls: [sendCall({ friend: "somebody" })] },
      { calls: [sendCall({})] },
    ]);
    const result = await runSignalTurn({ store, agent: "aaron", signalId: SIGNAL_ID, contextId, wallNow: () => clock });
    expect(result.status).toBe("completed");
    expect(result.toolCalls.filter((call) => call.name === "send_to_friend_agent").map((call) => call.ok)).toEqual([false, true]);
    expect(await store.listMessages()).toHaveLength(1);
  });

  it("opens the thread in code when the model never sends (the scripted fallback)", async () => {
    installFakeModel([{ text: "I think we should go." }, { text: "Still thinking." }]);
    const result = await runSignalTurn({ store, agent: "aaron", signalId: SIGNAL_ID, contextId, wallNow: () => clock });
    expect(result.nudged).toBe(true);
    expect(result).toMatchObject({ status: "completed", fallback: true, failure: { detail: "no_tool_call" } });
    expect(await store.getPlanByContext(contextId)).toMatchObject({ state: "negotiating" });
    const [record] = await store.listMessages();
    expect(record.message).toMatchObject({ from: "aaron", to: "lisa", type: "intent", activity: { title: "Shawarma Point" } });
    expect(record.proof).toBeUndefined();
  });
});
