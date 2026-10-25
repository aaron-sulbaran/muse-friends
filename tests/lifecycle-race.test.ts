import { beforeEach, describe, expect, it } from "vitest";
import { advanceClock, decide, reconcilePlan, recordHandoff } from "@/lib/agent/lifecycle";
import { withLock } from "@/lib/agent/lock";
import { SHAWARMA_CONTEXT_ID, SHAWARMA_PLAN_ID, recordedSnapshot } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";

let store: JsonStore;
beforeEach(async () => {
  store = new JsonStore(null);
  await store.replaceAll(recordedSnapshot());
});

const tap = (agent: "aaron" | "lisa", choice: "accept" | "decline" = "accept") => decide(store, { planId: SHAWARMA_PLAN_ID, agent, choice });
const events = async (kind: string) => (await store.listEvents()).filter((event) => event.kind === kind);

describe("two people tapping at the same moment", () => {
  it("both yeses land and the plan confirms (Lane B's repro)", async () => {
    const [a, b] = await Promise.all([tap("aaron"), tap("lisa")]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    const plan = (await store.getPlan(SHAWARMA_PLAN_ID))!;
    expect(plan.decisions).toEqual({ aaron: "accepted", lisa: "accepted" });
    expect(plan.state).toBe("confirmed");
    expect((await store.listCards({ planId: SHAWARMA_PLAN_ID })).map((card) => card.status)).toEqual(["accepted", "accepted"]);
    expect(await events("human_decision")).toHaveLength(2);
    expect((await events("plan_state")).filter((event) => event.text.includes("confirmed"))).toHaveLength(1);
  });

  it("a yes and a no at once drops the plan exactly once", async () => {
    await Promise.all([tap("aaron", "accept"), tap("lisa", "decline")]);
    const plan = (await store.getPlan(SHAWARMA_PLAN_ID))!;
    expect(plan).toMatchObject({ state: "dropped", dropReason: "declined" });
    expect(await store.getThread(SHAWARMA_CONTEXT_ID)).toMatchObject({ state: "rejected" });
    expect((await events("plan_state")).filter((event) => event.text.includes("dropped"))).toHaveLength(1);
  });

  it("the same person tapping twice records one decision", async () => {
    const results = await Promise.all([tap("aaron"), tap("aaron"), tap("aaron", "decline")]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.status === 409)).toHaveLength(2);
    expect((await store.getPlan(SHAWARMA_PLAN_ID))?.decisions.aaron).toBe("accepted");
    expect(await events("human_decision")).toHaveLength(1);
  });

  it("opening the draft twice issues one hold", async () => {
    await tap("aaron");
    await tap("lisa");
    const open = () => recordHandoff(store, { planId: SHAWARMA_PLAN_ID, agent: "aaron", via: "whatsapp" });
    const results = await Promise.all([open(), open(), open()]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(await events("hold_issued")).toHaveLength(1);
    expect((await store.getPlan(SHAWARMA_PLAN_ID))?.history.filter((entry) => entry.state === "scheduled")).toHaveLength(1);
  });

  it("a double-clicked clock step moves once", async () => {
    await tap("aaron");
    await tap("lisa");
    await recordHandoff(store, { planId: SHAWARMA_PLAN_ID, agent: "aaron", via: "copy" });
    const results = await Promise.all([advanceClock(store, { step: "reminder" }), advanceClock(store, { step: "reminder" })]);
    expect(results.map((result) => result.ok).sort()).toEqual([false, true]);
    expect((await store.getPlan(SHAWARMA_PLAN_ID))?.history.filter((entry) => entry.state === "reminded")).toHaveLength(1);
    expect((await events("clock_advanced"))).toHaveLength(1);
  });
});

describe("two server instances sharing one database", () => {
  // Each "instance" has its own lock table, so nothing serializes them: only the cards can save the plan.
  async function onInstance<T>(locks: Map<string, Promise<unknown>>, start: () => Promise<T>): Promise<T> {
    (globalThis as { __museLocks?: Map<string, Promise<unknown>> }).__museLocks = locks;
    return start();
  }

  it("still confirms when the plan writes overwrite each other", async () => {
    const results = await Promise.all([
      onInstance(new Map(), () => tap("aaron")),
      onInstance(new Map(), () => tap("lisa")),
    ]);
    (globalThis as { __museLocks?: unknown }).__museLocks = undefined;
    expect(results.every((result) => result.ok)).toBe(true);
    const plan = (await store.getPlan(SHAWARMA_PLAN_ID))!;
    expect(plan.decisions).toEqual({ aaron: "accepted", lisa: "accepted" });
    expect(plan.state).toBe("confirmed");
  });

  it("reconcilePlan repairs a plan that lost an update, from the cards alone", async () => {
    const [aaronCard, lisaCard] = await store.listCards({ planId: SHAWARMA_PLAN_ID });
    await store.putCard({ ...aaronCard, status: "accepted" });
    await store.putCard({ ...lisaCard, status: "accepted" });
    expect((await store.getPlan(SHAWARMA_PLAN_ID))?.decisions).toEqual({ aaron: "pending", lisa: "pending" });

    const repaired = await reconcilePlan(store, SHAWARMA_PLAN_ID, "2026-10-25T14:05:00-05:00");
    expect(repaired).toMatchObject({ state: "confirmed", decisions: { aaron: "accepted", lisa: "accepted" } });
    // Running it again changes nothing.
    const again = await reconcilePlan(store, SHAWARMA_PLAN_ID, "2026-10-25T14:06:00-05:00");
    expect(again?.history).toEqual(repaired?.history);
    expect(await events("plan_state")).toHaveLength(2);
  });

  it("a decline on one card drops the plan even if the plan row never heard", async () => {
    const [, lisaCard] = await store.listCards({ planId: SHAWARMA_PLAN_ID });
    await store.putCard({ ...lisaCard, status: "declined" });
    expect(await reconcilePlan(store, SHAWARMA_PLAN_ID, "2026-10-25T14:05:00-05:00")).toMatchObject({ state: "dropped", dropReason: "declined" });
  });
});

describe("withLock", () => {
  it("runs same-key work one after another and different keys independently", async () => {
    const order: string[] = [];
    const slow = (name: string, ms: number) => async () => {
      order.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      order.push(`${name}:end`);
      return name;
    };
    const results = await Promise.all([withLock("k", slow("a", 20)), withLock("k", slow("b", 1)), withLock("other", slow("c", 1))]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(order.indexOf("a:end")).toBeLessThan(order.indexOf("b:start"));
    expect(order.indexOf("c:start")).toBeLessThan(order.indexOf("a:end"));
  });

  it("keeps going after a failure and passes the error to its own caller only", async () => {
    const failing = withLock("k", async () => {
      throw new Error("boom");
    });
    const next = withLock("k", async () => "still runs");
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("still runs");
  });
});
