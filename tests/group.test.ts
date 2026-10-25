import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as postMemberDecision } from "@/app/api/plans/[id]/member-decision/route";
import { groupCandidates, startGroup } from "@/lib/agent/group";
import { advanceClock, decide, recordHandoff } from "@/lib/agent/lifecycle";
import { runInboxTurn, runSignalTurn } from "@/lib/agent/runtime";
import { localDeliver, type ReceiveResult } from "@/lib/agent/wire";
import type { MemberId, Plan, Window } from "@/lib/protocol";
import { PRIVATE_STRINGS, rawShawarmaSignal } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";

// The group of three: Sprout (aaron) starts it, Mochi (lisa) and Pebble (kai) are the friends. Tuesday evening
// is the only time all three are free: Sprout after 6, Mochi 5 to 8, Pebble from 6:30.
const ALL_THREE: Window = { start: "2026-10-27T18:30:00-05:00", end: "2026-10-27T20:00:00-05:00" };
const AARON_TUE: Window = { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T21:00:00-05:00" };
const food = { kind: "food", title: "Shawarma Point", place: "E 6th St" };
const SIGNAL_ID = rawShawarmaSignal().id;

let store: JsonStore;
let clock: number;
let plan: Plan;
let contexts: Record<"lisa" | "kai", string>;

const wallNow = () => (clock += 3000);
const send = (friend: MemberId, args: Record<string, unknown>) => ({ name: "send_to_friend_agent", args: { friend, ...args } });
const readAndLook = [
  { calls: [{ name: "read_signal", args: {} }] },
  { calls: [{ name: "record_reel_details", args: { place: "Shawarma Point", area: "E 6th St" } }, { name: "get_my_calendar", args: { start: "2026-10-26", end: "2026-11-01" } }] },
];

beforeEach(async () => {
  store = new JsonStore(null);
  clock = Date.parse("2026-10-24T20:00:00-05:00");
  const started = await startGroup(store, { ...rawShawarmaSignal(), id: SIGNAL_ID }, { wallNow });
  plan = (await store.getPlan(started.planId))!;
  contexts = { lisa: started.contexts.lisa!, kai: started.contexts.kai! };
});
afterEach(removeFakeModel);

const received: ReceiveResult[] = [];
const deliverAs = (sender: MemberId) => localDeliver(store, sender, (accepted) => received.push(accepted));

async function open(overrides: { note?: string } = {}) {
  installFakeModel([
    ...readAndLook,
    {
      calls: [
        send("lisa", { type: "intent", reason: "interest_match", activity: food, windows: [AARON_TUE], share: ["food"], ...overrides }),
        send("kai", { type: "intent", reason: "interest_match", activity: food, windows: [AARON_TUE], share: ["food"], ...overrides }),
      ],
    },
  ]);
  return runSignalTurn({ store, agent: "aaron", signalId: SIGNAL_ID, contextId: plan.contextId, group: plan.group, wallNow, deliver: deliverAs("aaron") });
}

async function friendReplies(friend: "lisa" | "kai", type: "counter" | "accept" | "decline", windows: Window[] = [ALL_THREE], extra: Record<string, unknown> = {}) {
  installFakeModel([{ calls: [send("aaron", { type, reason: type === "decline" ? "not_interested" : "both_free", ...(windows.length > 0 ? { windows } : {}), ...extra })] }]);
  const before = received.length;
  const result = await runInboxTurn({ store, agent: friend, contextId: contexts[friend], wallNow, deliver: deliverAs(friend) });
  return { result, delivered: received.slice(before) };
}

async function coordinatorAccepts(window: Window = ALL_THREE, fakeSteps?: Parameters<typeof installFakeModel>[0]) {
  installFakeModel(fakeSteps ?? [{ calls: [send("lisa", { type: "accept", reason: "both_free", windows: [window] }), send("kai", { type: "accept", reason: "both_free", windows: [window] })] }]);
  return runInboxTurn({ store, agent: "aaron", contextId: contexts.kai, wallNow, deliver: deliverAs("aaron") });
}

// Runs the whole negotiation to the point where the friends have both accepted.
async function negotiate() {
  await open();
  await friendReplies("lisa", "counter");
  await friendReplies("kai", "counter");
  await coordinatorAccepts();
  await friendReplies("lisa", "accept");
  await friendReplies("kai", "accept");
}

describe("starting a group", () => {
  it("makes one plan with a group, a context for each friend, and opens the coordinator's close pair with Pebble", async () => {
    expect(plan.group).toMatchObject({ coordinator: "aaron", members: ["aaron", "lisa", "kai"], rounds: 1, quorum: "all" });
    expect(Object.keys(plan.group!.contexts).sort()).toEqual(["kai", "lisa"]);
    expect(plan).toMatchObject({ state: "detected", initiator: "aaron" });
    expect(await store.getPolicy("aaron", "kai")).toMatchObject({ tier: "close" });
    expect(await store.getPolicy("kai", "aaron")).toMatchObject({ tier: "close" });
    expect((await store.listEvents()).map((event) => event.kind)).toEqual(["signal_received", "plan_state"]);
  });
});

describe("the fan-out", () => {
  it("opens one ordinary pair thread per friend, both tagged with the groupId, from one model turn", async () => {
    const result = await open();
    expect(result.status).toBe("completed");
    expect(result.toolCalls.filter((call) => call.name === "send_to_friend_agent").map((call) => call.ok)).toEqual([true, true]);

    const threads = await Promise.all([store.getThread(contexts.lisa), store.getThread(contexts.kai)]);
    for (const thread of threads) expect(thread).toMatchObject({ groupId: plan.group!.groupId, initiator: "aaron", state: "working", messageCount: 1 });
    expect(threads.map((thread) => thread!.participants.flat())).toEqual([expect.arrayContaining(["aaron", "lisa"]), expect.arrayContaining(["aaron", "kai"])]);
    expect((await store.getPlan(plan.id))?.state).toBe("negotiating");
    expect((await store.listMessages()).map((record) => [record.message.from, record.message.to, record.message.type]).sort()).toEqual([
      ["aaron", "kai", "intent"],
      ["aaron", "lisa", "intent"],
    ]);
  });

  it("fails every pair thread and drops the plan when the model never sends to both friends", async () => {
    installFakeModel([...readAndLook, { calls: [send("lisa", { type: "intent", reason: "interest_match", activity: food, windows: [AARON_TUE] })] }, { text: "done" }, { text: "done" }]);
    const result = await runSignalTurn({ store, agent: "aaron", signalId: SIGNAL_ID, contextId: plan.contextId, group: plan.group, wallNow, deliver: deliverAs("aaron") });
    expect(result.status).toBe("failed");
    expect(await store.getPlan(plan.id)).toMatchObject({ state: "dropped", dropReason: "cap_reached" });
  });
});

describe("the coordinator waits for everyone", () => {
  it("does not run the coordinator turn until both friends have answered, and then runs it exactly once", async () => {
    await open();
    const first = await friendReplies("lisa", "counter");
    expect(first.delivered.map((result) => (result.ok ? result.runTurn : null))).toEqual([false]);
    const second = await friendReplies("kai", "counter");
    expect(second.delivered.map((result) => (result.ok ? result.runTurn : null))).toEqual([true]);
    expect((await store.getPlan(plan.id))?.group?.rounds).toBe(2);
  });

  it("runs the coordinator once even when both answers land at the same time", async () => {
    await open();
    const before = received.length;
    installFakeModel([{ calls: [send("aaron", { type: "counter", reason: "both_free", windows: [ALL_THREE] })] }, { calls: [send("aaron", { type: "counter", reason: "both_free", windows: [ALL_THREE] })] }]);
    await Promise.all(
      (["lisa", "kai"] as const).map((friend) => runInboxTurn({ store, agent: friend, contextId: contexts[friend], wallNow, deliver: deliverAs(friend) })),
    );
    const turns = received.slice(before).filter((result) => result.ok && result.runTurn);
    expect(turns).toHaveLength(1);
  });

  it("works the shared windows out in code from the coordinator's free time and both answers", async () => {
    await open();
    await friendReplies("lisa", "counter");
    expect(await groupCandidates(store, (await store.getPlan(plan.id))!)).toEqual([]);
    await friendReplies("kai", "counter");
    expect(await groupCandidates(store, (await store.getPlan(plan.id))!)).toEqual([ALL_THREE]);
  });
});

describe("agreeing on one window", () => {
  it("reaches awaiting_humans with the window every member is free for, and one card for each of the three", async () => {
    await negotiate();
    const settled = (await store.getPlan(plan.id))!;
    expect(settled).toMatchObject({ state: "awaiting_humans", window: ALL_THREE, activity: { title: "Shawarma Point" } });
    expect(settled.group).toMatchObject({ rounds: 2, decisions: { aaron: "pending", lisa: "pending", kai: "pending" } });
    expect(settled.draft).toBeTruthy();

    const cards = await store.listCards({ planId: plan.id });
    expect(cards.map((card) => card.forAgent).sort()).toEqual(["aaron", "kai", "lisa"]);
    for (const card of cards) {
      expect(card).toMatchObject({ status: "pending", window: ALL_THREE, group: { groupId: plan.group!.groupId, members: ["aaron", "lisa", "kai"] } });
    }
    const aaronCard = cards.find((card) => card.forAgent === "aaron")!;
    expect(aaronCard.text).toMatch(/You, Mochi and Pebble/);
    expect(aaronCard.draft).toBeTruthy();
    expect(cards.find((card) => card.forAgent === "kai")?.draft).toBeUndefined();
    expect(cards.find((card) => card.forAgent === "kai")?.text).toMatch(/Sprout/);

    const threads = await Promise.all([store.getThread(contexts.lisa), store.getThread(contexts.kai)]);
    expect(threads.map((thread) => thread?.state)).toEqual(["input-required", "input-required"]);
  });

  it("writes the timeline for three: one agreement row and a card for each person, all from the group", async () => {
    await negotiate();
    const events = await store.listEvents();
    expect(events.filter((event) => event.kind === "card_created")).toHaveLength(3);
    const agreed = events.find((event) => event.kind === "plan_state" && /agreed/.test(event.text));
    expect(agreed?.text).toMatch(/Sprout, Mochi and Pebble agreed/);
    expect(events.filter((event) => event.kind === "message_sent")).toHaveLength(8);
    // The third friend has no phone seat, so her rows carry no agent; the two seats keep theirs.
    const sent = events.filter((event) => event.kind === "message_sent");
    expect(sent.map((event) => event.agent)).toEqual(expect.arrayContaining(["aaron", "lisa"]));
    for (const event of sent) expect(["aaron", "lisa", undefined]).toContain(event.agent);
  });

  it("settles once when the last two accepts land at the same moment", async () => {
    await open();
    await friendReplies("lisa", "counter");
    await friendReplies("kai", "counter");
    await coordinatorAccepts();
    installFakeModel([
      { calls: [send("aaron", { type: "accept", reason: "both_free", windows: [ALL_THREE] })] },
      { calls: [send("aaron", { type: "accept", reason: "both_free", windows: [ALL_THREE] })] },
    ]);
    await Promise.all(
      (["lisa", "kai"] as const).map((friend) => runInboxTurn({ store, agent: friend, contextId: contexts[friend], wallNow, deliver: deliverAs(friend) })),
    );
    expect((await store.getPlan(plan.id))?.state).toBe("awaiting_humans");
    expect(await store.listCards({ planId: plan.id })).toHaveLength(3);
    expect((await store.listEvents()).filter((event) => event.kind === "card_created")).toHaveLength(3);
  });

  it("refuses a coordinator accept that is not among the windows worked out in code, and lets the model repair it", async () => {
    await open();
    // Mochi can do 6 to 8; Pebble only from 6:30. Mochi's offer is fine for the pair, but not for the three.
    const mochiWide: Window = { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" };
    await friendReplies("lisa", "counter", [mochiWide]);
    await friendReplies("kai", "counter");
    const result = await coordinatorAccepts(ALL_THREE, [
      { calls: [send("lisa", { type: "accept", reason: "both_free", windows: [mochiWide] })] },
      { calls: [send("lisa", { type: "accept", reason: "both_free", windows: [ALL_THREE] }), send("kai", { type: "accept", reason: "both_free", windows: [ALL_THREE] })] },
    ]);
    expect(result.toolCalls[0]).toMatchObject({ ok: false });
    expect(result.toolCalls[0].error).toMatch(/not free for everyone in the group/);
    expect(result.toolCalls.slice(1).map((call) => call.ok)).toEqual([true, true]);
  });
});

describe("what the pair threads keep apart", () => {
  it("drops the coordinator's note in a group thread, so one friend's words cannot be carried to the other", async () => {
    installFakeModel([
      ...readAndLook,
      {
        calls: [
          send("lisa", { type: "intent", reason: "interest_match", activity: food, windows: [AARON_TUE], note: "Pebble is only free after 6:30" }),
          send("kai", { type: "intent", reason: "interest_match", activity: food, windows: [AARON_TUE], note: "Mochi has therapy at 8" }),
        ],
      },
    ]);
    await runSignalTurn({ store, agent: "aaron", signalId: SIGNAL_ID, contextId: plan.contextId, group: plan.group, wallNow, deliver: deliverAs("aaron") });
    const records = await store.listMessages();
    expect(records).toHaveLength(2);
    for (const record of records) expect(record.message.note).toBeUndefined();
  });

  it("never delivers any member's private string to anyone, across all three pair conversations", async () => {
    await open();
    await friendReplies("lisa", "counter", [ALL_THREE], { note: "Free then, after my physical therapy" });
    await friendReplies("kai", "counter", [ALL_THREE], { note: "Before the family wedding weekend" });
    const delivered = JSON.stringify((await store.listMessages()).map((record) => record.message));
    for (const secrets of Object.values(PRIVATE_STRINGS)) for (const secret of secrets) expect(delivered).not.toContain(secret);
    expect(delivered).not.toMatch(/therapy|wedding|Weekend away/i);
  });

  it("applies each pair's own privacy gate: location withheld from Pebble, still shared with Mochi", async () => {
    await store.putPolicy({ owner: "aaron", friend: "kai", tier: "close", categories: { location: false } });
    installFakeModel([
      ...readAndLook,
      {
        calls: [
          send("lisa", { type: "intent", reason: "interest_match", activity: food, windows: [AARON_TUE], share: ["food", "location"] }),
          send("kai", { type: "intent", reason: "interest_match", activity: food, windows: [AARON_TUE], share: ["food", "location"] }),
        ],
      },
    ]);
    await runSignalTurn({ store, agent: "aaron", signalId: SIGNAL_ID, contextId: plan.contextId, group: plan.group, wallNow, deliver: deliverAs("aaron") });
    const [toLisa, toKai] = await Promise.all([store.listMessages(contexts.lisa), store.listMessages(contexts.kai)]);
    expect(toLisa[0].message.activity?.place).toBe("E 6th St");
    expect(toKai[0].message.activity?.place).toBeUndefined();
    expect(toKai[0].stamp.removed).toEqual(["location"]);
  });

  it("keeps the 6 message cap on each pair thread on its own", async () => {
    await negotiate();
    const [lisaThread, kaiThread] = await Promise.all([store.getThread(contexts.lisa), store.getThread(contexts.kai)]);
    expect(lisaThread?.messageCount).toBe(4);
    expect(kaiThread?.messageCount).toBe(4);
  });
});

describe("when someone cannot make it", () => {
  it("drops the plan for everyone when one friend declines in round 1", async () => {
    await open();
    await friendReplies("lisa", "counter");
    const kai = await friendReplies("kai", "decline", [], { note: "Not this week" });
    expect(kai.result.status).toBe("completed");
    expect(await store.getPlan(plan.id)).toMatchObject({ state: "dropped", dropReason: "declined" });
    expect(await store.listCards({ planId: plan.id })).toHaveLength(0);
  });

  it("does not agree on a window when the three calendars share none", async () => {
    await open();
    await friendReplies("lisa", "counter");
    // Pebble answers with a window that is free for her but outside what Mochi can do.
    const lateTue: Window = { start: "2026-10-27T20:30:00-05:00", end: "2026-10-27T22:00:00-05:00" };
    await friendReplies("kai", "counter", [lateTue]);
    const candidates = await groupCandidates(store, (await store.getPlan(plan.id))!);
    expect(candidates).toEqual([]);
  });
});

describe("the plan's life with three people", () => {
  it("confirms only when all three say yes, in any order, and a no from anyone drops it", async () => {
    await negotiate();
    expect((await decide(store, { planId: plan.id, agent: "kai", choice: "accept" }, { wallNow })).ok).toBe(true);
    expect((await store.getPlan(plan.id))?.state).toBe("awaiting_humans");
    await decide(store, { planId: plan.id, agent: "aaron", choice: "accept" }, { wallNow });
    expect((await store.getPlan(plan.id))?.state).toBe("awaiting_humans");
    await decide(store, { planId: plan.id, agent: "lisa", choice: "accept" }, { wallNow });
    expect(await store.getPlan(plan.id)).toMatchObject({ state: "confirmed", group: { decisions: { aaron: "accepted", lisa: "accepted", kai: "accepted" } } });
    expect((await decide(store, { planId: plan.id, agent: "kai", choice: "accept" }, { wallNow })).ok).toBe(false);
  });

  it("drops the plan and closes all three pair threads when the third person declines", async () => {
    await negotiate();
    await decide(store, { planId: plan.id, agent: "aaron", choice: "accept" }, { wallNow });
    await decide(store, { planId: plan.id, agent: "kai", choice: "decline" }, { wallNow });
    expect(await store.getPlan(plan.id)).toMatchObject({ state: "dropped", dropReason: "declined" });
    const threads = await Promise.all([store.getThread(contexts.lisa), store.getThread(contexts.kai)]);
    expect(threads.map((thread) => thread?.state)).toEqual(["rejected", "rejected"]);
  });

  it("settles three simultaneous taps without losing one", async () => {
    await negotiate();
    await Promise.all((["aaron", "lisa", "kai"] as const).map((agent) => decide(store, { planId: plan.id, agent, choice: "accept" }, { wallNow })));
    expect((await store.getPlan(plan.id))?.state).toBe("confirmed");
  });

  it("carries a confirmed group through the hold, the reminder, and the follow-up for all three", async () => {
    await negotiate();
    for (const agent of ["aaron", "lisa", "kai"] as const) await decide(store, { planId: plan.id, agent, choice: "accept" }, { wallNow });
    const handoff = await recordHandoff(store, { planId: plan.id, agent: "aaron", via: "whatsapp" }, { wallNow });
    expect(handoff.ok).toBe(true);
    expect((await store.getPlan(plan.id))?.state).toBe("scheduled");
    await advanceClock(store, { step: "reminder" }, { wallNow });
    expect((await store.getPlan(plan.id))?.state).toBe("reminded");
    await advanceClock(store, { step: "next_day" }, { wallNow });
    expect((await store.getPlan(plan.id))?.state).toBe("followed_up");
    const events = await store.listEvents();
    // A reminder and a follow-up from each of the three agents; the third has no phone seat, so no agent on its rows.
    const reminders = events.filter((event) => event.text.includes("reminded their person"));
    const followUps = events.filter((event) => event.text.includes("again next month?"));
    expect(reminders.map((event) => event.agent)).toEqual(["aaron", "lisa", undefined]);
    expect(followUps.map((event) => event.agent)).toEqual(["aaron", "lisa", undefined]);
    expect(reminders.map((event) => event.text.split(" ")[0])).toEqual(["Sprout", "Mochi", "Pebble"]);
    expect(events.filter((event) => event.kind === "followed_through")).toHaveLength(1);
    expect(events.filter((event) => event.kind === "hold_issued")).toHaveLength(1);
  });
});

describe("the third person's decision route", () => {
  const post = (body: unknown) =>
    postMemberDecision(new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {
      params: Promise.resolve({ id: plan.id }),
    } as never);

  beforeEach(() => {
    (globalThis as { __museStore?: Promise<JsonStore> }).__museStore = Promise.resolve(store);
  });
  afterEach(() => {
    delete (globalThis as { __museStore?: unknown }).__museStore;
  });

  it("lets Pebble's person answer by member id, once, and confirms when the other two have said yes", async () => {
    await negotiate();
    await decide(store, { planId: plan.id, agent: "aaron", choice: "accept" }, { wallNow });
    await decide(store, { planId: plan.id, agent: "lisa", choice: "accept" }, { wallNow });
    const yes = await post({ member: "kai", choice: "accept" });
    expect(yes.status).toBe(200);
    expect((await store.getPlan(plan.id))?.state).toBe("confirmed");
    expect((await post({ member: "kai", choice: "accept" })).status).toBe(409);
  });

  it("refuses a name that is not a member and a body that is not a decision", async () => {
    await negotiate();
    expect((await post({ member: "nobody", choice: "accept" })).status).toBe(400);
    expect((await post({ role: "a", choice: "accept" })).status).toBe(400);
  });
});
