import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentMessage } from "@/lib/protocol";
import { agentToken, receiveMessage } from "@/lib/agent/wire";
import { injectSignal, runInboxTurn, runSignalTurn } from "@/lib/agent/runtime";
import { rawShawarmaSignal } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";
import { slowStore } from "./helpers/slowStore";
import { installWireShim } from "./helpers/wire";

// `after` only works inside a request; collect the callbacks and run them where the test says.
const scheduled: Array<() => unknown> = [];
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (callback: () => unknown) => void scheduled.push(callback) }));

const DELAY = 10;
const TUE = { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" };
const stamp = { passed: ["availability"], removed: [], windowsDropped: 0 };
const bearer = (agent: "aaron" | "lisa") => ({ authorization: `Bearer ${agentToken(agent)}`, "content-type": "application/json" });

let uninstallWire: (() => void) | undefined;
afterEach(() => {
  uninstallWire?.();
  uninstallWire = undefined;
  removeFakeModel();
  (globalThis as { __museStore?: unknown }).__museStore = undefined;
});
beforeEach(() => {
  scheduled.length = 0;
});

function intent(contextId: string) {
  return AgentMessage.parse({
    id: "msg_1",
    contextId,
    seq: 1,
    from: "aaron",
    to: "lisa",
    type: "intent",
    state: "working",
    activity: { kind: "food", title: "Shawarma Point" },
    windows: [TUE],
    reason: "interest_match",
    note: "Want to go this week?",
    at: "2026-10-25T14:00:08-05:00",
  });
}

async function postToInbox(id: "lisa" | "aaron" | "kai", body: unknown, sender: "aaron" | "lisa" | "kai") {
  const { POST } = await import("@/app/api/agents/[id]/inbox/route");
  return POST(new Request(`http://localhost:3001/api/agents/${id}/inbox`, { method: "POST", headers: bearer(sender), body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
}

describe("the inbox with a slow store", () => {
  it("answers 202 in a few store round trips, not one per write, and before any model call", async () => {
    const { store, depth, reset } = slowStore(DELAY);
    (globalThis as { __museStore?: unknown }).__museStore = Promise.resolve(store);
    const { contextId } = await injectSignal(store, rawShawarmaSignal());
    const model = installFakeModel([]);

    reset();
    const response = await postToInbox("lisa", { message: intent(contextId), stamp, redaction: null }, "aaron");

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ contextId, seq: 1, status: { state: "working" } });
    // Reads together, then the core's reads together, then its writes together: three round trips, however
    // slow each one is. One call after another would be a dozen or more.
    expect(depth()).toBeLessThanOrEqual(3);
    expect(model.calls).toHaveLength(0);
    expect(scheduled).toHaveLength(1);
    // The message is durable, the cosmetic rows are not yet.
    expect(await store.listMessages(contextId)).toHaveLength(1);
    expect((await store.listEvents()).map((event) => event.kind)).toEqual(["signal_received"]);
  });

  it("finishes the timeline rows in order after the response, then runs the receiver's turn", async () => {
    const { store, calls } = slowStore(20);
    (globalThis as { __museStore?: unknown }).__museStore = Promise.resolve(store);
    const { contextId } = await injectSignal(store, rawShawarmaSignal());
    const model = installFakeModel([
      { calls: [{ name: "send_to_friend_agent", args: { friend: "aaron", type: "accept", reason: "both_free", windows: [TUE] } }] },
      { calls: [{ name: "send_to_friend_agent", args: { friend: "lisa", type: "accept", reason: "both_free", windows: [TUE] } }] },
    ]);
    uninstallWire = installWireShim();

    await postToInbox("lisa", { message: intent(contextId), stamp, redaction: null }, "aaron");
    expect(model.calls).toHaveLength(0);
    const before = calls.length;
    while (scheduled.length > 0) await scheduled.shift()!();

    expect(model.calls).toHaveLength(2);
    expect((await store.listEvents()).map((event) => event.kind)).toEqual([
      "signal_received",
      "thread_opened",
      "message_sent",
      "message_sent",
      "message_sent",
      "plan_state",
      "card_created",
      "card_created",
    ]);
    expect(calls.slice(before).indexOf("appendEvent")).toBeGreaterThan(-1);
    expect(await store.getThread(contextId)).toMatchObject({ messageCount: 3, state: "input-required" });
  });

  it("does not let a retry that races its original commit twice", async () => {
    const { store } = slowStore(30);
    (globalThis as { __museStore?: unknown }).__museStore = Promise.resolve(store);
    const { contextId } = await injectSignal(store, rawShawarmaSignal());
    const body = { message: intent(contextId), stamp, redaction: null };
    const [first, second] = await Promise.all([postToInbox("lisa", body, "aaron"), postToInbox("lisa", body, "aaron")]);
    expect([first.status, second.status]).toEqual([202, 202]);
    expect(await store.listMessages(contextId)).toHaveLength(1);
    expect(scheduled).toHaveLength(2);
    // Only one of the two answers asks for a turn.
    uninstallWire = installWireShim();
    const model = installFakeModel([{ calls: [{ name: "send_to_friend_agent", args: { friend: "aaron", type: "accept", reason: "both_free", windows: [TUE] } }] }]);
    for (const callback of scheduled.splice(0)) await callback();
    expect(model.calls).toHaveLength(1);
  });

  it("runs the whole shawarma thread against a slow store with every row in order", async () => {
    const { store } = slowStore(15);
    const { contextId } = await injectSignal(store, rawShawarmaSignal());
    installFakeModel([
      { calls: [{ name: "read_signal", args: {} }] },
      { calls: [{ name: "record_reel_details", args: { place: "Shawarma Point" } }, { name: "get_my_calendar", args: { start: "2026-10-26", end: "2026-11-01" } }] },
      { calls: [{ name: "send_to_friend_agent", args: { friend: "lisa", type: "intent", reason: "interest_match", activity: { kind: "food", title: "Shawarma Point" }, windows: [TUE] } }] },
      { calls: [{ name: "send_to_friend_agent", args: { friend: "aaron", type: "accept", reason: "both_free", windows: [TUE] } }] },
      { calls: [{ name: "send_to_friend_agent", args: { friend: "lisa", type: "accept", reason: "both_free", windows: [TUE] } }] },
    ]);
    (globalThis as { __museStore?: unknown }).__museStore = Promise.resolve(store);
    uninstallWire = installWireShim();
    const { httpDeliver } = await import("@/lib/agent/wire");
    await runSignalTurn({ store, agent: "aaron", signalId: rawShawarmaSignal().id, contextId, deliver: httpDeliver("http://demo.local", "aaron") });
    while (scheduled.length > 0) await scheduled.shift()!();
    const plan = await store.getPlanByContext(contextId);
    expect(plan?.state).toBe("awaiting_humans");
    expect(await store.listCards({ planId: plan!.id })).toHaveLength(2);
    expect((await store.listEvents()).map((event) => event.kind)).toEqual([
      "signal_received",
      "caption_extracted",
      "thread_opened",
      "message_sent",
      "message_sent",
      "message_sent",
      "plan_state",
      "card_created",
      "card_created",
    ]);
  });
});

describe("a thread that hits the cap", () => {
  const send = (contextId: string, seq: number, from: "aaron" | "lisa", type: "counter" | "accept", state: "working") =>
    AgentMessage.parse({
      id: `msg_${seq}`,
      contextId,
      seq,
      from,
      to: from === "aaron" ? "lisa" : "aaron",
      type,
      state,
      windows: [TUE],
      reason: "both_free",
      at: "2026-10-25T14:00:08-05:00",
    });

  it("lands as failed with reason cap_reached, drops the plan, shows it on the timeline, and runs no further turn", async () => {
    const store = new JsonStore(null);
    (globalThis as { __museStore?: unknown }).__museStore = Promise.resolve(store);
    const { contextId } = await injectSignal(store, rawShawarmaSignal());
    const thread = [
      send(contextId, 1, "aaron", "counter", "working"),
      send(contextId, 2, "lisa", "counter", "working"),
      send(contextId, 3, "aaron", "counter", "working"),
      send(contextId, 4, "lisa", "counter", "working"),
      send(contextId, 5, "aaron", "counter", "working"),
      send(contextId, 6, "lisa", "accept", "working"),
    ];
    for (const [index, message] of thread.entries()) {
      const sender = message.from;
      const response = await postToInbox(message.to, { message, stamp, redaction: null }, sender);
      expect(response.status, `message ${index + 1}`).toBe(202);
      if (index === 5) expect(await response.json()).toMatchObject({ seq: 6, status: { state: "failed" } });
    }

    const model = installFakeModel([]);
    for (const callback of scheduled.splice(0)) await callback();
    expect(model.calls).toHaveLength(0);

    expect(await store.getThread(contextId)).toMatchObject({ state: "failed", messageCount: 6, dropReason: "cap_reached" });
    expect(await store.getPlanByContext(contextId)).toMatchObject({ state: "dropped", dropReason: "cap_reached" });
    const last = (await store.listEvents()).at(-1);
    expect(last).toMatchObject({ kind: "plan_state", actor: "system", text: "Plan dropped: no agreement within 6 messages (cap reached)" });
  });

  it("does not call the model for an agent whose thread already ended", async () => {
    const store = new JsonStore(null);
    const { contextId } = await injectSignal(store, rawShawarmaSignal());
    await store.putThread({
      contextId,
      planId: "p",
      initiator: "aaron",
      participants: ["aaron", "lisa"],
      state: "failed",
      messageCount: 6,
      dropReason: "cap_reached",
      createdAt: "2026-10-25T14:00:00-05:00",
      updatedAt: "2026-10-25T14:00:00-05:00",
    });
    const model = installFakeModel([]);
    const result = await runInboxTurn({ store, agent: "lisa", contextId });
    expect(result.status).toBe("completed");
    expect(model.calls).toHaveLength(0);
  });

  it("an agent turn that fails at the cap is dropped with the same reason and a timeline row", async () => {
    const store = new JsonStore(null);
    const { contextId } = await injectSignal(store, rawShawarmaSignal());
    installFakeModel([{ text: "Sounds fun" }, { text: "Really" }]);
    await runSignalTurn({ store, agent: "aaron", signalId: rawShawarmaSignal().id, contextId });
    expect(await store.getPlanByContext(contextId)).toMatchObject({ state: "dropped", dropReason: "cap_reached" });
    expect((await store.listEvents()).at(-1)).toMatchObject({ kind: "turn_failed" });
    expect((await store.listEvents()).at(-1)?.text).toContain("cap_reached");
  });
});

describe("receiveMessage on a slow store (unit)", () => {
  it("spends no more than three sequential round trips on the way to the 202", async () => {
    const { store, calls, depth, reset } = slowStore(10);
    const { contextId } = await injectSignal(store, rawShawarmaSignal());
    reset();
    const result = await receiveMessage(store, { recipient: "lisa", sender: "aaron", envelope: { message: intent(contextId), stamp, redaction: null } });
    expect(result.ok).toBe(true);
    expect(depth()).toBeLessThanOrEqual(3);
    // Nothing cosmetic is on the way to the 202: the timeline rows wait for finish().
    expect(calls.filter((name) => name === "appendEvent")).toHaveLength(0);
    if (result.ok) await result.finish();
    expect(calls.filter((name) => name === "appendEvent").length).toBeGreaterThan(0);
  });
});
