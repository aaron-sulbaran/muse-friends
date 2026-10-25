import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDemo } from "@/lib/agent/controls";
import { startGroup } from "@/lib/agent/group";
import { runSignalTurn } from "@/lib/agent/runtime";
import { sendToFriend } from "@/lib/agent/outbox";
import { localDeliver, receiveMessage } from "@/lib/agent/wire";
import type { AgentRuntimeContext } from "@/lib/agent/context";
import { AgentMessage, type MemberId, type Plan, type Window } from "@/lib/protocol";
import { rawShawarmaSignal } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";

// Production dropped 2 of 4 live group runs at 9:08 and 9:11 on Sun Oct 25 with a plan that looked half written: dropped
// (no_overlap), no group members, and exactly one message in the thread, Sprout to Kai, a decline with no intent before it.
// The code path that makes that shape: a message arrives for a conversation the store knows nothing about (the room was reset
// under a running turn, or the group plan is not visible yet), the inbox invents a fresh pair plan for it, and a decline
// ends that plan at once. These tests pin the shape and the guards that make it impossible.

const AARON_TUE: Window = { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T21:00:00-05:00" };
const food = { kind: "food", title: "Shawarma Point", place: "E 6th St" };
const SIGNAL_ID = rawShawarmaSignal().id;

let store: JsonStore;
let clock: number;
let plan: Plan;
const wallNow = () => (clock += 3000);

beforeEach(async () => {
  process.env.MODEL_RETRY_SCALE = "0";
  store = new JsonStore(null);
  clock = Date.parse("2026-10-24T20:00:00-05:00");
  const started = await startGroup(store, { ...rawShawarmaSignal(), id: SIGNAL_ID }, { wallNow });
  plan = (await store.getPlan(started.planId))!;
});
afterEach(() => {
  removeFakeModel();
  delete process.env.MODEL_RETRY_SCALE;
});

const send = (friend: MemberId, args: Record<string, unknown>) => ({ name: "send_to_friend_agent", args: { friend, ...args } });

const groupContext = (extra: Partial<AgentRuntimeContext> = {}): AgentRuntimeContext => ({
  agent: "aaron",
  store,
  wallNow,
  signalId: SIGNAL_ID,
  contextId: plan.contextId,
  deliver: localDeliver(store, "aaron"),
  windowRepairs: { used: 0 },
  group: plan.group,
  counterparts: ["lisa", "kai"],
  contexts: plan.group!.contexts,
  ...extra,
});

describe("a turn that outlives its room", () => {
  it("cannot leave a lone decline and an invented pair plan behind after a reset", async () => {
    // The opening turn is running (the model has the group's contexts in hand) when the room is reset under it.
    await resetDemo(store, {}, { wallNow });
    expect(await store.listPlans()).toEqual([]);

    installFakeModel([{ calls: [send("kai", { type: "decline", reason: "no_overlap" })] }, { text: "done" }]);
    await runSignalTurn({ store, agent: "aaron", signalId: SIGNAL_ID, contextId: plan.contextId, group: plan.group, wallNow, deliver: localDeliver(store, "aaron") });

    // Nothing may be written into the new room by the old turn: no message, no thread, no invented plan.
    expect(await store.listMessages()).toEqual([]);
    expect(await store.listThreads()).toEqual([]);
    expect(await store.listPlans()).toEqual([]);
  });

  it("is told why, in words the model can act on", async () => {
    await resetDemo(store, {}, { wallNow });
    const result = await sendToFriend(groupContext(), { friend: "kai", type: "intent", reason: "interest_match", activity: food, windows: [AARON_TUE] });
    expect(result).toMatchObject({ error: expect.stringMatching(/no longer there|was reset/i) });
  });
});

describe("a group plan that is not visible yet", () => {
  it("waits a moment for it instead of inventing a pair plan, then sends into the real plan", async () => {
    // A store whose read of the group plan lags behind its write (another instance, another connection). Real pauses here.
    process.env.MODEL_RETRY_SCALE = "1";
    let visibleAt = Date.now() + 400;
    const lagging = new Proxy(store, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== "function") return value;
        if (property === "listPlans") return async () => (Date.now() < visibleAt ? [] : target.listPlans());
        if (property === "getPlanByContext" || property === "getPlan") return async (...args: unknown[]) => (Date.now() < visibleAt ? null : Reflect.apply(value, target, args));
        return (...args: unknown[]) => Reflect.apply(value, target, args);
      },
    });
    const result = await sendToFriend(groupContext({ store: lagging as JsonStore, deliver: localDeliver(store, "aaron") }), { friend: "kai", type: "intent", reason: "interest_match", activity: food, windows: [AARON_TUE] });
    expect("error" in result ? result.error : "sent").toBe("sent");
    visibleAt = 0;
    const plans = await store.listPlans();
    expect(plans).toHaveLength(1);
    expect(plans[0].id).toBe(plan.id);
    expect(plans[0].group?.members).toEqual(["aaron", "lisa", "kai"]);
  });

  it("gives up with a clear error if it never shows up, and writes nothing", async () => {
    process.env.MODEL_RETRY_SCALE = "0";
    const blind = new Proxy(store, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property === "listPlans") return async () => [];
        if (property === "getPlanByContext" || property === "getPlan") return async () => null;
        return typeof value === "function" ? (...args: unknown[]) => Reflect.apply(value, target, args) : value;
      },
    });
    const result = await sendToFriend(groupContext({ store: blind as JsonStore }), { friend: "kai", type: "intent", reason: "interest_match", activity: food, windows: [AARON_TUE] });
    expect(result).toMatchObject({ error: expect.stringMatching(/no longer there|was reset/i) });
    expect(await store.listMessages()).toEqual([]);
  });
});

describe("the inbox", () => {
  const decline = (contextId: string) =>
    AgentMessage.parse({ id: "msg_orphan", contextId, seq: 1, from: "aaron", to: "kai", type: "decline", state: "rejected", reason: "no_overlap", at: "2026-10-25T09:11:00-05:00" });

  it("will not let a decline or an accept open a conversation, so it can never invent a plan", async () => {
    const fresh = new JsonStore(null);
    for (const type of ["decline", "accept"] as const) {
      const message = type === "decline" ? decline("ctx_unknown") : AgentMessage.parse({ ...decline("ctx_unknown"), type: "accept", state: "input-required", reason: "both_free", windows: [AARON_TUE] });
      const result = await receiveMessage(fresh, { recipient: "kai", sender: "aaron", envelope: { message, stamp: { passed: [], removed: [], windowsDropped: 0 }, redaction: null } });
      expect(result).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/opens with an intent, a proposal or a counter/) });
    }
    expect(await fresh.listPlans()).toEqual([]);
    expect(await fresh.listThreads()).toEqual([]);
    expect(await fresh.listMessages()).toEqual([]);
    expect((await fresh.listEvents()).filter((event) => event.kind === "message_rejected")).toHaveLength(2);
  });

  it("still opens with an intent, a proposal or a counter", async () => {
    for (const [index, type] of (["intent", "propose", "counter"] as const).entries()) {
      const fresh = new JsonStore(null);
      const message = AgentMessage.parse({ id: `msg_open_${index}`, contextId: `ctx_open_${index}`, seq: 1, from: "aaron", to: "lisa", type, state: "working", reason: "both_free", activity: food, windows: [AARON_TUE], at: "2026-10-25T09:11:00-05:00" });
      const result = await receiveMessage(fresh, { recipient: "lisa", sender: "aaron", envelope: { message, stamp: { passed: ["availability"], removed: [], windowsDropped: 0 }, redaction: null } });
      expect(result.ok, type).toBe(true);
    }
  });
});
