import { beforeEach, describe, expect, it } from "vitest";
import { addBusyBlock, recordCurrentRun, resetDemo, setSharePolicy } from "@/lib/agent/controls";
import { advanceClock, currentPlan, decide, recordHandoff } from "@/lib/agent/lifecycle";
import { StateSnapshot } from "@/lib/protocol";
import { SHAWARMA_CONTEXT_ID, SHAWARMA_PLAN_ID, recordedSnapshot } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";

let store: JsonStore;
let clock: number;
const options = () => ({ wallNow: () => (clock += 1000) });

beforeEach(async () => {
  store = new JsonStore(null);
  clock = Date.parse("2026-10-24T21:00:00-05:00");
  await store.replaceAll(recordedSnapshot());
});

const ok = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

describe("decide", () => {
  it("records one yes without moving the plan", async () => {
    const { plan, cards } = ok(await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "aaron", choice: "accept" }, options()));
    expect(plan).toMatchObject({ state: "awaiting_humans", decisions: { aaron: "accepted", lisa: "pending" } });
    expect(cards.find((card) => card.forAgent === "aaron")?.status).toBe("accepted");
    expect((await store.listCards({ forAgent: "lisa" }))[0].status).toBe("pending");
    const event = (await store.listEvents()).at(-1);
    expect(event).toMatchObject({ kind: "human_decision", actor: "human", agent: "aaron", text: "Sprout said yes to Shawarma Point" });
  });

  it("confirms on two yeses, in either order, and issues the hold", async () => {
    await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "lisa", choice: "accept" }, options());
    const { plan } = ok(await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "aaron", choice: "accept" }, options()));
    expect(plan.state).toBe("scheduled");
    expect(plan.history.map((entry) => entry.state)).toEqual(["detected", "negotiating", "awaiting_humans", "confirmed", "scheduled"]);
    expect(await store.getThread(SHAWARMA_CONTEXT_ID)).toMatchObject({ state: "completed" });
    expect((await store.listEvents()).slice(-3).map((event) => event.kind)).toEqual(["human_decision", "plan_state", "hold_issued"]);
  });

  it("drops the plan when either person says no", async () => {
    const { plan } = ok(await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "lisa", choice: "decline" }, options()));
    expect(plan).toMatchObject({ state: "dropped", dropReason: "declined" });
    expect(await store.getThread(SHAWARMA_CONTEXT_ID)).toMatchObject({ state: "rejected", dropReason: "declined" });
    expect((await store.listCards({ forAgent: "lisa" }))[0].status).toBe("declined");
  });

  it("refuses a second decision from the same person, an unknown plan, and a plan not waiting", async () => {
    await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "aaron", choice: "accept" }, options());
    expect(await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "aaron", choice: "decline" })).toMatchObject({ ok: false, status: 409 });
    expect(await decide(store, { planId: "plan_nope", agent: "aaron", choice: "accept" })).toMatchObject({ ok: false, status: 404 });
    await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "lisa", choice: "accept" }, options());
    expect(await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "lisa", choice: "accept" })).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("scheduled") });
  });
});

describe("recordHandoff", () => {
  it("logs the human opening WhatsApp or copying the draft, and returns the draft", async () => {
    const result = ok(await recordHandoff(store, { planId: SHAWARMA_PLAN_ID, agent: "aaron", via: "whatsapp" }, options()));
    expect(result.draft).toContain("Hey Mochi");
    await recordHandoff(store, { planId: SHAWARMA_PLAN_ID, agent: "aaron", via: "copy" }, options());
    const texts = (await store.listEvents()).filter((event) => event.kind === "handoff_opened").map((event) => event.text);
    expect(texts).toEqual(["Sprout opened WhatsApp with the drafted message", "Sprout copied the drafted message"]);
  });

  it("refuses when there is no draft or no plan", async () => {
    expect(await recordHandoff(store, { planId: "nope", agent: "aaron", via: "copy" })).toMatchObject({ ok: false, status: 404 });
    const plan = (await store.getPlan(SHAWARMA_PLAN_ID))!;
    await store.putPlan({ ...plan, draft: undefined });
    expect(await recordHandoff(store, { planId: SHAWARMA_PLAN_ID, agent: "aaron", via: "copy" })).toMatchObject({ ok: false, status: 409 });
  });
});

describe("advanceClock", () => {
  async function scheduled() {
    await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "aaron", choice: "accept" }, options());
    await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "lisa", choice: "accept" }, options());
  }

  it("walks scheduled to followed_up, one step at a time", async () => {
    await scheduled();
    const reminded = ok(await advanceClock(store, { step: "next" }));
    expect(reminded.plan.state).toBe("reminded");
    expect(reminded.clock.now).toBe("2026-10-27T16:00:00-05:00");

    const happened = ok(await advanceClock(store));
    expect(happened.plan.state).toBe("happened");
    expect(happened.clock.now).toBe("2026-10-27T20:00:00-05:00");

    const followedUp = ok(await advanceClock(store));
    expect(followedUp.plan.state).toBe("followed_up");
    expect(followedUp.clock.now).toBe("2026-10-28T10:00:00-05:00");
    expect((await store.getClock()).now).toBe("2026-10-28T10:00:00-05:00");
  });

  it("writes a reminder from each agent, one human follow-through event, and a follow-up from each", async () => {
    await scheduled();
    for (let step = 0; step < 3; step += 1) ok(await advanceClock(store));
    const events = await store.listEvents();
    expect(events.filter((event) => event.kind === "clock_advanced")).toHaveLength(3);
    expect(events.filter((event) => event.text.includes("reminded their person")).map((event) => event.agent)).toEqual(["aaron", "lisa"]);
    const followed = events.filter((event) => event.kind === "followed_through");
    expect(followed).toHaveLength(1);
    expect(followed[0].actor).toBe("human");
    expect(events.filter((event) => event.text.includes("again next month?")).map((event) => event.agent)).toEqual(["aaron", "lisa"]);
  });

  it("accepts a named step only when it is the next one, and never moves backward", async () => {
    await scheduled();
    expect(await advanceClock(store, { step: "end" })).toMatchObject({ ok: false, status: 409 });
    expect(await advanceClock(store, { step: "next_day" })).toMatchObject({ ok: false, status: 409 });
    ok(await advanceClock(store, { step: "reminder" }));
    expect(await advanceClock(store, { step: "reminder" })).toMatchObject({ ok: false, status: 409 });
  });

  it("will not move a plan that is still waiting for people, finished, or missing", async () => {
    expect(await advanceClock(store)).toMatchObject({ ok: false, status: 409 });
    await scheduled();
    for (let step = 0; step < 3; step += 1) ok(await advanceClock(store));
    expect(await advanceClock(store)).toMatchObject({ ok: false, status: 409 });
    expect(await advanceClock(new JsonStore(null))).toMatchObject({ ok: false, status: 404 });
  });

  it("moves the clock only forward even if it is already past the target", async () => {
    await scheduled();
    await store.setClock({ now: "2026-10-27T17:30:00-05:00" });
    const { clock: moved } = ok(await advanceClock(store));
    expect(moved.now).toBe("2026-10-27T17:30:00-05:00");
  });

  it("finds the most recent live plan", async () => {
    expect((await currentPlan(store))?.id).toBe(SHAWARMA_PLAN_ID);
    await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "lisa", choice: "decline" }, options());
    expect(await currentPlan(store)).toBeNull();
  });
});

describe("setSharePolicy replays the person's messages under the new setting", () => {
  it("removes Mochi's location from her propose, stamps it withheld, and logs the redaction", async () => {
    const before = (await store.listMessages()).find((record) => record.message.seq === 2)!;
    expect(before.message.activity?.place).toBe("E 6th St");
    expect(before.stamp.removed).toEqual([]);

    const { policy, replayed } = ok(await setSharePolicy(store, { owner: "lisa", friend: "aaron", categories: { location: false } }, options()));
    expect(policy.categories.location).toBe(false);
    expect(replayed).toHaveLength(1);

    const after = (await store.listMessages()).find((record) => record.message.seq === 2)!;
    expect(after.message.id).toBe(before.message.id);
    expect(after.message.activity).toEqual({ kind: "food", title: "Shawarma Point" });
    expect(after.message.shared?.location).toBeUndefined();
    expect(after.message.shared?.food).toEqual(before.message.shared?.food);
    expect(after.message.windows).toEqual(before.message.windows);
    expect(after.stamp).toMatchObject({ removed: ["location"] });
    expect(after.stamp.passed).not.toContain("location");

    const [redaction] = await store.listRedactions(SHAWARMA_CONTEXT_ID);
    expect(redaction).toMatchObject({ messageId: before.message.id, removed: ["location"], from: "lisa", to: "aaron" });
    expect(JSON.stringify(redaction)).not.toMatch(/E 6th St|East Austin/);
    expect(redaction.detail).toContain("replayed under the new setting");

    const kinds = (await store.listEvents()).slice(-2).map((event) => event.kind);
    expect(kinds).toEqual(["policy_changed", "redaction"]);
  });

  it("leaves the other person's messages and the other direction alone", async () => {
    const aaronBefore = (await store.listMessages()).filter((record) => record.message.from === "aaron");
    await setSharePolicy(store, { owner: "lisa", friend: "aaron", categories: { location: false } }, options());
    expect((await store.listMessages()).filter((record) => record.message.from === "aaron")).toEqual(aaronBefore);
    expect((await store.getPolicy("aaron", "lisa"))?.categories.location).toBe(true);
  });

  it("changes nothing in the messages when the setting removes nothing, and nothing twice", async () => {
    const first = ok(await setSharePolicy(store, { owner: "lisa", friend: "aaron", categories: { interests: false } }, options()));
    expect(first.replayed).toHaveLength(0);
    ok(await setSharePolicy(store, { owner: "lisa", friend: "aaron", categories: { location: false } }, options()));
    const again = ok(await setSharePolicy(store, { owner: "lisa", friend: "aaron", categories: { location: false } }, options()));
    expect(again.replayed).toHaveLength(0);
    expect(await store.listRedactions()).toHaveLength(1);
  });

  it("leaves a message as sent when removing the data would break it", async () => {
    const { replayed } = ok(await setSharePolicy(store, { owner: "lisa", friend: "aaron", categories: { availability: false } }, options()));
    expect(replayed.filter((entry) => entry.removed.includes("availability"))).toHaveLength(0);
    expect((await store.listMessages()).find((record) => record.message.seq === 2)?.message.windows).toHaveLength(3);
  });

  it("sets a policy for a friend who had none, defaulting to off, and refuses self", async () => {
    await store.replaceAll({ ...recordedSnapshot(), policies: [] });
    const { policy } = ok(await setSharePolicy(store, { owner: "lisa", friend: "aaron", categories: { food: true } }, options()));
    expect(policy).toMatchObject({ tier: "off", categories: { food: true } });
    expect(await setSharePolicy(store, { owner: "lisa", friend: "lisa" })).toMatchObject({ ok: false, status: 422 });
  });
});

describe("controls", () => {
  it("adds a busy block that the calendar and the send checks then respect", async () => {
    const block = ok(await addBusyBlock(store, { agent: "lisa", start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00", title: "Dentist" }, options()));
    expect(block.event).toMatchObject({ private: true, title: "Dentist" });
    expect(await store.listBusy("lisa")).toHaveLength(1);
    const { ownFreeBlocks } = await import("@/lib/agent/calendar");
    const free = await ownFreeBlocks(store, "lisa", { start: "2026-10-27T00:00:00-05:00", end: "2026-10-28T00:00:00-05:00" });
    expect(free.some((window) => window.start === "2026-10-27T18:00:00-05:00")).toBe(false);
    expect((await store.listEvents()).at(-1)).toMatchObject({ kind: "busy_added", text: "Mochi marked Tue 6 to 8pm as busy" });
  });

  it("refuses nonsense and times outside the seeded calendar", async () => {
    expect(await addBusyBlock(store, { agent: "lisa", start: "soon", end: "later" })).toMatchObject({ ok: false, status: 422 });
    expect(await addBusyBlock(store, { agent: "lisa", start: "2026-10-27T20:00:00-05:00", end: "2026-10-27T18:00:00-05:00" })).toMatchObject({ ok: false, status: 422 });
    expect(await addBusyBlock(store, { agent: "lisa", start: "2026-12-01T18:00:00-05:00", end: "2026-12-01T20:00:00-05:00" })).toMatchObject({ ok: false, status: 422 });
  });

  it("resets to the seed, counts the reset, and keeps recorded runs", async () => {
    await recordCurrentRun(store, { id: "run_live_1", label: "First live run" }, options());
    await setSharePolicy(store, { owner: "lisa", friend: "aaron", categories: { location: false } }, options());
    const { resetCount } = await resetDemo(store, { simulatedFriend: true }, options());
    expect(resetCount).toBe(1);
    const snapshot = await store.snapshot();
    expect(StateSnapshot.safeParse(snapshot).success).toBe(true);
    expect(snapshot).toMatchObject({ threads: [], plans: [], messages: [], cards: [], room: { simulatedFriend: true, resetCount: 1 } });
    expect(snapshot.policies.find((policy) => policy.owner === "lisa")?.categories.location).toBe(true);
    expect(snapshot.events.map((event) => event.kind)).toEqual(["room_reset"]);
    expect(snapshot.clock.now).toBe("2026-10-25T14:00:00-05:00");
    expect(await store.getRecordedRun("run_live_1")).toMatchObject({ source: "live", scenario: "shawarma" });
  });

  it("records the store as a Replay run", async () => {
    const run = await recordCurrentRun(store, { id: "run_live_2", label: "Second" }, options());
    expect(run.snapshot.messages).toHaveLength(6);
    expect((await store.listRecordedRuns()).map((entry) => entry.id)).toEqual(["run_live_2"]);
  });
});
