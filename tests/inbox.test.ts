import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMessage, type AgentMessage as Message } from "@/lib/protocol";
import { validateIncoming } from "@/lib/policy";
import { freeBlocks, windowHash } from "@/lib/agent/windows";
import { agentToken, authenticateSender, receiveMessage } from "@/lib/agent/wire";
import { injectSignal } from "@/lib/agent/runtime";
import { CALENDAR_RANGE, PERSONAS, rawShawarmaSignal } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";

// `after` only works inside a request; tests collect the callbacks instead of running them.
const scheduled: Array<() => unknown> = [];
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (callback: () => unknown) => void scheduled.push(callback) }));

const TUE = { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" };
const food = { kind: "food", title: "Shawarma Point" } as const;

function intent(overrides: Partial<Message> = {}): Message {
  return AgentMessage.parse({
    id: "msg_1",
    contextId: "ctx_1",
    seq: 1,
    from: "aaron",
    to: "lisa",
    type: "intent",
    state: "working",
    activity: food,
    windows: [TUE],
    reason: "interest_match",
    note: "Want to go this week?",
    at: "2026-10-25T14:00:08-05:00",
    ...overrides,
  });
}

const stamp = { passed: ["availability"], removed: [], windowsDropped: 0 };
const bearer = (agent: "aaron" | "lisa") => ({ authorization: `Bearer ${agentToken(agent)}`, "content-type": "application/json" });

describe("validateIncoming", () => {
  type Inputs = Omit<Parameters<typeof validateIncoming>[0], "raw">;
  const base: Inputs = {
    authenticatedSender: "aaron",
    recipient: "lisa",
    thread: null,
    prior: [],
    senderFreeBlocks: freeBlocks(PERSONAS.aaron.calendar, CALENDAR_RANGE),
    senderPolicy: { owner: "aaron", friend: "lisa", tier: "close", categories: {} },
    senderPersona: PERSONAS.aaron,
    rejectedWindowHashes: [],
  };
  const check = (raw: unknown, overrides: Partial<Inputs> = {}) => validateIncoming({ ...base, ...overrides, raw });

  it("accepts a clean opening message", () => {
    expect(check(intent())).toMatchObject({ ok: true });
  });

  it("rejects what the schema rejects: extra keys, long notes, too many windows", () => {
    expect(check({ ...intent(), rationale: "because" })).toMatchObject({ ok: false, status: 422 });
    expect(check({ ...intent(), note: "x".repeat(141) })).toMatchObject({ ok: false, status: 422 });
    expect(check({ ...intent(), windows: [TUE, TUE, TUE, TUE] })).toMatchObject({ ok: false, status: 422 });
    expect(check("not an object")).toMatchObject({ ok: false, status: 422 });
  });

  it("rejects a sender that is not who the token says", () => {
    expect(check(intent(), { authenticatedSender: "lisa" })).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects a message addressed to someone else", () => {
    expect(check(intent(), { recipient: "aaron" })).toMatchObject({ ok: false, status: 422 });
  });

  describe("turn order", () => {
    const thread = (state: "working" | "input-required"): NonNullable<Inputs["thread"]> => ({
      contextId: "ctx_1",
      planId: "plan_1",
      initiator: "aaron",
      participants: ["aaron", "lisa"],
      state,
      messageCount: 1,
      createdAt: "2026-10-25T14:00:00-05:00",
      updatedAt: "2026-10-25T14:00:00-05:00",
    });
    const lisaReply = (overrides: Partial<Message> = {}) =>
      intent({ id: "msg_2", seq: 2, from: "lisa", to: "aaron", type: "counter", reason: "both_free", note: undefined, ...overrides });
    const lisaSide: Partial<Inputs> = {
      authenticatedSender: "lisa",
      recipient: "aaron",
      senderFreeBlocks: freeBlocks(PERSONAS.lisa.calendar, CALENDAR_RANGE),
      senderPersona: PERSONAS.lisa,
      senderPolicy: { owner: "lisa", friend: "aaron", tier: "close", categories: {} },
    };

    it("accepts the friend's reply in sequence", () => {
      expect(check(lisaReply(), { ...lisaSide, thread: thread("working"), prior: [intent()] })).toMatchObject({ ok: true });
    });

    it("rejects the wrong seq", () => {
      expect(check(intent({ seq: 2 }))).toMatchObject({ ok: false, status: 409 });
      expect(check(lisaReply({ seq: 3 }), { ...lisaSide, thread: thread("working"), prior: [intent()] })).toMatchObject({ ok: false, status: 409 });
    });

    it("rejects a sender who just spoke", () => {
      expect(check(intent({ id: "msg_2", seq: 2, type: "counter", reason: "both_free" }), { thread: thread("working"), prior: [intent()] })).toMatchObject({ ok: false, status: 409, error: "not the sender's turn" });
    });

    it("rejects a message into an ended thread", () => {
      expect(check(lisaReply(), { ...lisaSide, thread: thread("input-required"), prior: [intent()] })).toMatchObject({ ok: false, status: 409 });
    });

    it("rejects a non-closing sixth message", () => {
      const sixth = lisaReply({ seq: 6, type: "counter" });
      expect(check(sixth, { ...lisaSide, thread: { ...thread("working"), messageCount: 5 }, prior: [intent({ seq: 5 })] })).toMatchObject({ ok: false, status: 422 });
    });
  });

  it("rejects a claimed state that does not follow from the thread", () => {
    expect(check(intent({ state: "input-required" }))).toMatchObject({ ok: false, status: 422, error: "state does not follow from the thread" });
  });

  it("rejects a window the sender is not free for", () => {
    const invented = { start: "2026-10-27T10:00:00-05:00", end: "2026-10-27T12:00:00-05:00" };
    expect(check(intent({ windows: [invented] }))).toMatchObject({ ok: false, status: 422, error: "a window is outside the sender's free blocks" });
  });

  it("rejects a window already passed over", () => {
    expect(check(intent(), { rejectedWindowHashes: [windowHash(TUE)] })).toMatchObject({ ok: false, status: 422 });
  });

  it("applies the sender's share policy again and rejects data it does not allow, without echoing it", () => {
    const leaky = check(intent({ activity: { ...food, place: "E 6th St" } }), { senderPolicy: { owner: "aaron", friend: "lisa", tier: "close", categories: { location: false } } });
    expect(leaky).toMatchObject({ ok: false, status: 422 });
    expect(JSON.stringify(leaky)).not.toContain("E 6th St");
    const note = check(intent({ note: "I have my Northwind interview that day" }));
    expect(note).toMatchObject({ ok: false, status: 422 });
    expect(JSON.stringify(note)).not.toContain("Northwind");
  });
});

describe("bearer tokens", () => {
  it("maps each agent's token to that agent and nothing else", () => {
    expect(authenticateSender(`Bearer ${agentToken("aaron")}`)).toBe("aaron");
    expect(authenticateSender(`Bearer ${agentToken("lisa")}`)).toBe("lisa");
    expect(agentToken("aaron")).not.toBe(agentToken("lisa"));
    expect(authenticateSender("Bearer nope")).toBeNull();
    expect(authenticateSender(null)).toBeNull();
    expect(authenticateSender(agentToken("aaron"))).toBeNull();
  });

  it("honors AGENT_TOKEN_* when set", () => {
    process.env.AGENT_TOKEN_LISA = "configured-secret";
    try {
      expect(authenticateSender("Bearer configured-secret")).toBe("lisa");
      expect(authenticateSender("bearer configured-secret")).toBe("lisa");
    } finally {
      delete process.env.AGENT_TOKEN_LISA;
    }
  });
});

describe("receiveMessage", () => {
  let store: JsonStore;
  let contextId: string;
  beforeEach(async () => {
    store = new JsonStore(null);
    ({ contextId } = await injectSignal(store, rawShawarmaSignal(), () => Date.parse("2026-10-24T20:00:00-05:00")));
  });

  const envelope = (message: unknown) => ({ message, stamp, redaction: null });

  it("commits a valid message and asks for the receiver's turn", async () => {
    const result = await receiveMessage(store, { recipient: "lisa", sender: "aaron", envelope: envelope(intent({ contextId })) });
    expect(result).toMatchObject({ ok: true, status: 202, runTurn: true, body: { contextId, seq: 1, state: "working" } });
    expect(await store.listMessages(contextId)).toHaveLength(1);
  });

  it("acknowledges a retried message without applying it twice or running another turn", async () => {
    await receiveMessage(store, { recipient: "lisa", sender: "aaron", envelope: envelope(intent({ contextId })) });
    const again = await receiveMessage(store, { recipient: "lisa", sender: "aaron", envelope: envelope(intent({ contextId })) });
    expect(again).toMatchObject({ ok: true, runTurn: false });
    expect(await store.listMessages(contextId)).toHaveLength(1);
  });

  it("shows a rejection in the timeline without storing the message", async () => {
    const result = await receiveMessage(store, { recipient: "lisa", sender: "aaron", envelope: envelope(intent({ contextId, note: "My Northwind interview runs late" })) });
    expect(result).toMatchObject({ ok: false, status: 422 });
    expect(await store.listMessages(contextId)).toHaveLength(0);
    const event = (await store.listEvents()).find((row) => row.kind === "message_rejected");
    expect(event?.text).toContain("rejected a message from Sprout (422)");
    expect(event?.text).not.toContain("Northwind");
  });

  it("answers 400 to a malformed envelope", async () => {
    expect(await receiveMessage(store, { recipient: "lisa", sender: "aaron", envelope: { message: intent({ contextId }) } })).toMatchObject({ ok: false, status: 400 });
  });
});

describe("routes", () => {
  beforeEach(() => {
    scheduled.length = 0;
    process.env.STORE_PATH = path.join(mkdtempSync(path.join(tmpdir(), "muse-routes-")), "store.json");
    (globalThis as { __museStore?: unknown }).__museStore = undefined;
  });
  afterEach(() => {
    (globalThis as { __museStore?: unknown }).__museStore = undefined;
  });

  async function post(id: string, body: unknown, headers: Record<string, string>) {
    const { POST } = await import("@/app/api/agents/[id]/inbox/route");
    return POST(new Request(`http://localhost:3001/api/agents/${id}/inbox`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }), {
      params: Promise.resolve({ id }),
    });
  }

  it("answers 401 without a valid bearer token and 404 for an unknown agent", async () => {
    expect((await post("lisa", {}, {})).status).toBe(401);
    expect((await post("lisa", {}, { authorization: "Bearer wrong" })).status).toBe(401);
    expect((await post("nobody", {}, bearer("aaron"))).status).toBe(404);
  });

  it("will not let an agent message itself, and rejects bad JSON", async () => {
    expect((await post("aaron", {}, bearer("aaron"))).status).toBe(403);
    expect((await post("lisa", "{not json", bearer("aaron"))).status).toBe(400);
  });

  it("answers 202 with the task state, then schedules the receiver's turn after responding", async () => {
    const { getStore } = await import("@/lib/store");
    const store = await getStore();
    const { contextId } = await injectSignal(store, rawShawarmaSignal());
    const response = await post("lisa", { message: intent({ contextId }), stamp, redaction: null }, bearer("aaron"));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ contextId, seq: 1, status: { state: "working" } });
    expect(scheduled).toHaveLength(1);
    expect(await store.listMessages(contextId)).toHaveLength(1);
  });

  it("answers 422 to a message that breaks a rule and schedules nothing", async () => {
    const { getStore } = await import("@/lib/store");
    const store = await getStore();
    const { contextId } = await injectSignal(store, rawShawarmaSignal());
    const response = await post("lisa", { message: intent({ contextId, windows: [{ start: "2026-10-27T10:00:00-05:00", end: "2026-10-27T12:00:00-05:00" }] }), stamp, redaction: null }, bearer("aaron"));
    expect(response.status).toBe(422);
    expect(scheduled).toHaveLength(0);
  });

  it("schedules no further turn when the message completes the agreement", async () => {
    const { getStore } = await import("@/lib/store");
    const store = await getStore();
    const { contextId } = await injectSignal(store, rawShawarmaSignal());
    await post("lisa", { message: intent({ contextId }), stamp, redaction: null }, bearer("aaron"));
    scheduled.length = 0;
    const accept = (id: string, seq: number, from: "aaron" | "lisa", state: "working" | "input-required") =>
      ({ message: { ...intent({ contextId }), id, seq, from, to: from === "aaron" ? "lisa" : "aaron", type: "accept", state, windows: [TUE], note: undefined }, stamp, redaction: null });
    expect((await post("aaron", accept("m2", 2, "lisa", "working"), bearer("lisa"))).status).toBe(202);
    scheduled.length = 0;
    expect((await post("lisa", accept("m3", 3, "aaron", "input-required"), bearer("aaron"))).status).toBe(202);
    expect(scheduled).toHaveLength(0);
    expect((await store.getPlanByContext(contextId))?.state).toBe("awaiting_humans");
  });

  it("injects a signal and schedules the initiator's turn", async () => {
    const { POST } = await import("@/app/api/signals/route");
    const response = await POST(new Request("http://localhost:3001/api/signals", { method: "POST", body: "{}" }));
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toMatchObject({ contextId: expect.any(String), planId: expect.any(String), status: { state: "working" } });
    expect(scheduled).toHaveLength(1);
    const { getStore } = await import("@/lib/store");
    const store = await getStore();
    expect(await store.getSignal(body.signalId)).toMatchObject({ from: "lisa", to: "aaron" });
    expect((await store.getPlanByContext(body.contextId))?.state).toBe("detected");
  });

  it("rejects an unknown scenario", async () => {
    const { POST } = await import("@/app/api/signals/route");
    const response = await POST(new Request("http://localhost:3001/api/signals", { method: "POST", body: JSON.stringify({ scenario: "ski-trip" }) }));
    expect(response.status).toBe(400);
  });

  it("serves an agent card with A2A v0.3 field names", async () => {
    const { GET } = await import("@/app/agents/[id]/.well-known/agent-card.json/route");
    const response = await GET(new Request("http://localhost:3001/agents/aaron/.well-known/agent-card.json"), { params: Promise.resolve({ id: "aaron" }) });
    const card = await response.json();
    expect(card).toMatchObject({
      protocolVersion: "0.3.0",
      name: "Sprout, a Muse Friends agent",
      url: "http://localhost:3001/api/agents/aaron/inbox",
      version: "0.1.0",
      capabilities: { streaming: false, pushNotifications: false },
      defaultInputModes: ["application/json"],
      defaultOutputModes: ["application/json"],
      security: [{ agentBearer: [] }],
    });
    expect(card.skills[0]).toMatchObject({ id: "coordinate-plan", tags: expect.any(Array) });
    expect(card.description).toContain("not A2A-compliant");
    const missing = await GET(new Request("http://localhost:3001/x"), { params: Promise.resolve({ id: "nobody" }) });
    expect(missing.status).toBe(404);
  });
});
