import { describe, expect, it } from "vitest";
import { advanceClock, decide, recordHandoff } from "@/lib/agent/lifecycle";
import { SHAWARMA_PLAN_ID, recordedSnapshot } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import { ruleChoice } from "@/lib/ui/next-idea";
import { recordOutcome } from "@/lib/ui/outcome";
import { toUiSnapshot } from "@/lib/ui/snapshot";

const chooser = async () => ruleChoice();

async function storeAt(step: "reminder" | "end" | "next_day") {
  const store = new JsonStore(null);
  await store.replaceAll(recordedSnapshot());
  await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "aaron", choice: "accept" });
  await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "lisa", choice: "accept" });
  await recordHandoff(store, { planId: SHAWARMA_PLAN_ID, agent: "aaron", via: "whatsapp" });
  await advanceClock(store, { step });
  return store;
}

const ui = async (store: JsonStore) => toUiSnapshot(await store.snapshot(), { mode: "live" });

describe("the outcome: only a person's tap counts", () => {
  it("the clock ending the plan counts nothing", async () => {
    const store = await storeAt("end");
    expect((await ui(store)).followThrough.events).toHaveLength(0);
  });

  it("went counts 1 and fills the outcome with the next idea", async () => {
    const store = await storeAt("next_day");
    const result = await recordOutcome(store, { planId: SHAWARMA_PLAN_ID, role: "b", result: "went" }, { chooser });
    expect(result.ok).toBe(true);
    const snapshot = await ui(store);
    expect(snapshot.followThrough.events).toHaveLength(1);
    expect(snapshot.plan?.outcome).toMatchObject({ result: "went", nextIdeaId: ruleChoice().signalId, chosenBy: "rule" });
  });

  it("didnt counts 0", async () => {
    const store = await storeAt("next_day");
    const result = await recordOutcome(store, { planId: SHAWARMA_PLAN_ID, role: "a", result: "didnt" }, { chooser });
    expect(result.ok).toBe(true);
    const snapshot = await ui(store);
    expect(snapshot.followThrough.events).toHaveLength(0);
    expect(snapshot.plan?.outcome).toMatchObject({ result: "didnt", nextIdeaId: null });
  });

  it("refuses a second answer and an answer before the plan happened", async () => {
    const early = await storeAt("reminder");
    const refused = await recordOutcome(early, { planId: SHAWARMA_PLAN_ID, role: "a", result: "went" }, { chooser });
    expect(refused).toMatchObject({ ok: false, status: 409 });

    const store = await storeAt("end");
    expect((await recordOutcome(store, { planId: SHAWARMA_PLAN_ID, role: "a", result: "didnt" }, { chooser })).ok).toBe(true);
    expect(await recordOutcome(store, { planId: SHAWARMA_PLAN_ID, role: "b", result: "went" }, { chooser })).toMatchObject({ ok: false, status: 409 });
    expect((await ui(store)).followThrough.events).toHaveLength(0);
  });
});
