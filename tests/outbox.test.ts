import { beforeEach, describe, expect, it } from "vitest";
import type { AgentRuntimeContext } from "@/lib/agent/context";
import { injectSignal } from "@/lib/agent/runtime";
import { sendToFriend, type SendResult } from "@/lib/agent/outbox";
import { windowHash } from "@/lib/agent/windows";
import { PERSONAS, rawShawarmaSignal } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import type { AgentId, Window } from "@/lib/protocol";

// Free for both Aaron and Lisa as the seeded calendars stand (see tests/fixtures.test.ts).
const TUE: Window = { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" };
const SAT: Window = { start: "2026-10-31T18:00:00-05:00", end: "2026-10-31T21:00:00-05:00" };
// Free for Lisa; Aaron is free for the Monday one too, so each can be offered by its sender.
const MON_LATE: Window = { start: "2026-10-26T21:00:00-05:00", end: "2026-10-26T22:00:00-05:00" };
const LISA_WED: Window = { start: "2026-10-28T18:00:00-05:00", end: "2026-10-28T19:00:00-05:00" };
const food = { kind: "food", title: "Shawarma Point", place: "E 6th St" } as const;

let store: JsonStore;
let contextId: string;
let clock: number;

function ctxFor(agent: AgentId, overrides: Partial<AgentRuntimeContext> = {}): AgentRuntimeContext {
  clock += 5000;
  return { agent, store, contextId, wallNow: () => clock, windowRepairs: { used: 0 }, ...overrides };
}

const friendOf = (agent: AgentId) => (agent === "aaron" ? "lisa" : "aaron");

const send = (agent: AgentId, args: Record<string, unknown>, overrides?: Partial<AgentRuntimeContext>) =>
  sendToFriend(ctxFor(agent, { signalId: "sig_shawarma_001", ...overrides }), { friend: friendOf(agent), ...args });

const isError = (result: SendResult): result is { error: string } => "error" in result;

beforeEach(async () => {
  store = new JsonStore(null);
  clock = Date.parse("2026-10-24T20:00:00-05:00");
  ({ contextId } = await injectSignal(store, rawShawarmaSignal(), () => clock));
});

describe("sending the first message", () => {
  it("opens the thread, moves the plan to negotiating, and writes the timeline", async () => {
    const result = await send("aaron", { type: "intent", reason: "interest_match", activity: food, windows: [TUE, SAT], note: "Want to go this week?", share: ["food"] });
    expect(result).toMatchObject({ ok: true, seq: 1, state: "working" });

    expect(await store.getThread(contextId)).toMatchObject({ messageCount: 1, state: "working", initiator: "aaron", participants: ["aaron", "lisa"] });
    expect((await store.getPlanByContext(contextId))?.state).toBe("negotiating");
    const [record] = await store.listMessages(contextId);
    expect(record.message).toMatchObject({ seq: 1, from: "aaron", to: "lisa", shared: { food: PERSONAS.aaron.interests.food } });
    expect(record.stamp).toEqual({ passed: ["food", "availability", "location"], removed: [], windowsDropped: 0 });
    expect((await store.listEvents()).map((event) => event.kind)).toEqual(["signal_received", "thread_opened", "message_sent"]);
  });

  it("reads the friend's display name as the one friend", async () => {
    expect(await send("aaron", { friend: "Mochi", type: "intent", reason: "interest_match" })).toMatchObject({ ok: true });
  });

  it("refuses to message oneself", async () => {
    const result = await send("aaron", { friend: "aaron", type: "intent", reason: "interest_match" });
    expect(isError(result) && result.error).toMatch(/can only message/);
  });

  it("refuses without an open conversation or a signal", async () => {
    const result = await sendToFriend(ctxFor("lisa", { contextId: "ctx_nothing" }), { friend: "aaron", type: "intent", reason: "interest_match" });
    expect(isError(result) && result.error).toMatch(/no open conversation/);
  });

  it("returns schema problems to the model as text", async () => {
    const result = await send("aaron", { type: "propose", reason: "both_free" });
    expect(isError(result) && result.error).toMatch(/propose needs 1 to 3 windows/);
    expect(await store.listMessages()).toHaveLength(0);
  });
});

describe("windows are verified against the sender's own calendar", () => {
  const invented: Window = { start: "2026-10-27T10:00:00-05:00", end: "2026-10-27T12:00:00-05:00" };

  it("re-prompts once, then drops the invented window", async () => {
    const ctx = ctxFor("aaron", { signalId: "sig_shawarma_001" });
    const args = { friend: "lisa", type: "propose", reason: "both_free", windows: [TUE, invented] };
    const first = await sendToFriend(ctx, args);
    expect(isError(first) && first.error).toMatch(/not usable: Tue 10am to 12pm/);
    expect(await store.listMessages()).toHaveLength(0);

    expect(await sendToFriend(ctx, args)).toMatchObject({ ok: true });
    const [record] = await store.listMessages();
    expect(record.message.windows).toEqual([TUE]);
    expect(record.stamp.windowsDropped).toBe(1);
  });

  it("turns a propose left with no windows into a counter with no_overlap", async () => {
    const ctx = ctxFor("aaron", { signalId: "sig_shawarma_001", windowRepairs: { used: 1 } });
    expect(await sendToFriend(ctx, { friend: "lisa", type: "propose", reason: "both_free", windows: [invented] })).toMatchObject({ ok: true });
    const [record] = await store.listMessages();
    expect(record.message).toMatchObject({ type: "counter", reason: "no_overlap" });
    expect(record.message.windows).toBeUndefined();
  });

  it("refuses an accept whose window is not free", async () => {
    const ctx = ctxFor("aaron", { signalId: "sig_shawarma_001", windowRepairs: { used: 1 } });
    const result = await sendToFriend(ctx, { friend: "lisa", type: "accept", reason: "both_free", windows: [invented] });
    expect(isError(result) && result.error).toMatch(/cannot accept/);
  });

  it("asks for a shorter window when one runs past three hours", async () => {
    const long: Window = { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T22:00:00-05:00" };
    const result = await send("aaron", { type: "propose", reason: "both_free", windows: [long] });
    expect(isError(result) && result.error).toMatch(/at most 3 hours/);
  });

  it("uses judge-added busy blocks when checking", async () => {
    await store.addBusy({ agent: "aaron", event: { id: "busy-1", title: "Dentist", start: TUE.start, end: TUE.end, private: true } });
    const result = await send("aaron", { type: "propose", reason: "both_free", windows: [TUE] });
    expect(isError(result) && result.error).toMatch(/not usable/);
  });
});

describe("turn taking, the cap, and the ledger", () => {
  async function converse(steps: Array<[AgentId, Record<string, unknown>]>) {
    for (const [agent, args] of steps) {
      const result = await send(agent, args);
      expect(isError(result) ? result.error : "ok").toBe("ok");
    }
  }

  it("makes the sender wait for the friend's reply", async () => {
    await converse([["aaron", { type: "intent", reason: "interest_match" }]]);
    const result = await send("aaron", { type: "intent", reason: "interest_match" });
    expect(isError(result) && result.error).toMatch(/not your turn/);
  });

  it("only lets an accept agree to a window the friend offered", async () => {
    await converse([["aaron", { type: "intent", reason: "interest_match", windows: [TUE] }]]);
    const result = await send("lisa", { type: "accept", reason: "both_free", windows: [{ start: "2026-10-31T18:00:00-05:00", end: "2026-10-31T20:00:00-05:00" }] });
    expect(isError(result) && result.error).toMatch(/only accept a window your friend offered/);
  });

  it("records passed-over windows and blocks re-offering them", async () => {
    await converse([
      ["aaron", { type: "intent", reason: "interest_match" }],
      ["lisa", { type: "propose", reason: "interest_match", windows: [MON_LATE, TUE, LISA_WED] }],
      ["aaron", { type: "counter", reason: "both_free", windows: [TUE] }],
    ]);
    expect(new Set(await store.listRejectedWindows(contextId))).toEqual(new Set([windowHash(MON_LATE), windowHash(LISA_WED)]));

    const result = await send("lisa", { type: "counter", reason: "both_free", windows: [TUE, MON_LATE] });
    expect(isError(result) && result.error).toMatch(/already passed over/);
  });

  it("forces the sixth message to close the thread", async () => {
    await converse([
      ["aaron", { type: "intent", reason: "interest_match" }],
      ["lisa", { type: "propose", reason: "interest_match", windows: [TUE, SAT] }],
      ["aaron", { type: "counter", reason: "both_free", windows: [TUE, SAT] }],
      ["lisa", { type: "counter", reason: "both_free", windows: [TUE, SAT] }],
      ["aaron", { type: "counter", reason: "both_free", windows: [TUE, SAT] }],
    ]);
    const sixth = await send("lisa", { type: "counter", reason: "both_free", windows: [TUE] });
    expect(isError(sixth) && sixth.error).toMatch(/must be an accept or a decline/);
    expect(await send("lisa", { type: "accept", reason: "both_free", windows: [TUE] })).toMatchObject({ ok: true, seq: 6, state: "working" });
  });

  it("reaches awaiting_humans when both agents accept the same window, in four messages", async () => {
    await converse([
      ["aaron", { type: "intent", reason: "interest_match", activity: food, windows: [TUE, SAT] }],
      ["lisa", { type: "counter", reason: "both_free", windows: [TUE] }],
      ["aaron", { type: "accept", reason: "both_free", windows: [TUE] }],
    ]);
    expect(await send("lisa", { type: "accept", reason: "both_free", windows: [TUE] })).toMatchObject({ ok: true, seq: 4, state: "input-required" });

    expect(await store.getThread(contextId)).toMatchObject({ state: "input-required", messageCount: 4 });
    const plan = await store.getPlanByContext(contextId);
    expect(plan).toMatchObject({ state: "awaiting_humans", window: TUE, activity: { title: "Shawarma Point" } });
    expect(plan?.history.map((entry) => entry.state)).toEqual(["detected", "negotiating", "awaiting_humans"]);

    const after = await send("aaron", { type: "intent", reason: "interest_match" });
    expect(isError(after) && after.error).toMatch(/already ended/);
  });

  it("ends the thread and drops the plan on a decline", async () => {
    await converse([
      ["aaron", { type: "intent", reason: "interest_match" }],
      ["lisa", { type: "decline", reason: "not_interested", note: "Not this time, thanks." }],
    ]);
    expect(await store.getThread(contextId)).toMatchObject({ state: "rejected", dropReason: "declined" });
    expect(await store.getPlanByContext(contextId)).toMatchObject({ state: "dropped", dropReason: "declined" });
  });
});

describe("the share policy applies at send", () => {
  it("blanks the place when location is off and keeps a redaction without the value", async () => {
    await store.putPolicy({ owner: "aaron", friend: "lisa", tier: "close", categories: { location: false } });
    await send("aaron", { type: "intent", reason: "interest_match", activity: food, share: ["food", "location"] });
    const [record] = await store.listMessages();
    expect(record.message.activity).toEqual({ kind: "food", title: "Shawarma Point" });
    expect(record.message.shared).toEqual({ food: PERSONAS.aaron.interests.food });
    expect(record.stamp).toMatchObject({ removed: ["location"] });

    const [redaction] = await store.listRedactions(contextId);
    expect(redaction).toMatchObject({ removed: ["location"], messageId: record.message.id });
    expect(JSON.stringify(redaction)).not.toContain("E 6th St");
    expect((await store.listEvents()).some((event) => event.kind === "redaction")).toBe(true);
  });

  it("removes a note that names a private event and still delivers the message", async () => {
    await send("aaron", { type: "intent", reason: "interest_match", note: "I have my Northwind interview that day but later is fine" });
    const [record] = await store.listMessages();
    expect(record.message.note).toBeUndefined();
    expect(JSON.stringify(record)).not.toMatch(/Northwind|interview/i);
    expect(record.stamp.removed).toContain("events");
  });

  it("never lets the model write shared values", async () => {
    const result = await send("aaron", { type: "intent", reason: "interest_match", shared: { food: ["injected"] } });
    expect(isError(result) && result.error).toMatch(/Invalid message/);
  });

  it("with no policy for the friend shares nothing but can still open with an intent", async () => {
    await store.replaceAll({ ...(await store.snapshot()), policies: [] });
    await send("aaron", { type: "intent", reason: "interest_match", activity: food, windows: [TUE], share: ["food"] });
    const [record] = await store.listMessages();
    expect(record.message.windows).toBeUndefined();
    expect(record.message.shared).toBeUndefined();
    expect(record.message.activity?.place).toBeUndefined();
    expect(record.stamp.removed).toEqual(["availability", "location"]);
  });

  it("tells the model when the policy makes a message impossible", async () => {
    await store.putPolicy({ owner: "aaron", friend: "lisa", tier: "close", categories: { availability: false } });
    const result = await send("aaron", { type: "propose", reason: "both_free", windows: [TUE] });
    expect(isError(result) && result.error).toMatch(/sharing settings/);
    expect(await store.listMessages()).toHaveLength(0);
  });
});

describe("delivery", () => {
  it("hands the stamped record to an injected deliver instead of committing locally", async () => {
    const delivered: unknown[] = [];
    const result = await send("aaron", { type: "intent", reason: "interest_match" }, { deliver: async (outgoing) => (delivered.push(outgoing), { ok: true }) });
    expect(result).toMatchObject({ ok: true });
    expect(delivered).toHaveLength(1);
    expect(await store.listMessages()).toHaveLength(0);
  });

  it("reports a rejection from the friend's inbox to the model", async () => {
    const result = await send("aaron", { type: "intent", reason: "interest_match" }, { deliver: async () => ({ ok: false, status: 422, error: "windows not free" }) });
    expect(isError(result) && result.error).toMatch(/rejected the message \(422\)/);
  });
});
