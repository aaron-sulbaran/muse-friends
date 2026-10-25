import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as postFriend } from "@/app/api/simulated-friend/route";
import { POST as postMember } from "@/app/api/simulated-member/route";
import { resetRunBudget, runBudget } from "@/lib/agent/caps";
import { startGroup } from "@/lib/agent/group";
import { decide } from "@/lib/agent/lifecycle";
import type { Plan } from "@/lib/protocol";
import { rawShawarmaSignal } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import { memberDecides, memberInstructions } from "@/lib/ui/group";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";

// Kai, the third person of a plan for three, is played by a model when one judge plays alone: the same shape as
// Michelle's answer, with the same caps and the same refusals.

let store: JsonStore;
let plan: Plan;

const json = (body: unknown) => new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const answer = async (response: Response) => ({ status: response.status, body: (await response.json()) as Record<string, unknown> });

beforeEach(async () => {
  resetRunBudget();
  store = new JsonStore(null);
  (globalThis as { __museStore?: Promise<JsonStore> }).__museStore = Promise.resolve(store);
  const started = await startGroup(store, rawShawarmaSignal());
  const fresh = (await store.getPlan(started.planId))!;
  // The agents have agreed: the plan waits on the three people.
  plan = {
    ...fresh,
    state: "awaiting_humans",
    activity: { kind: "food", title: "Shawarma Point", place: "E 6th St" },
    window: { start: "2026-10-27T18:30:00-05:00", end: "2026-10-27T20:00:00-05:00" },
  };
  await store.putPlan(plan);
});
afterEach(() => {
  delete (globalThis as { __museStore?: unknown }).__museStore;
  delete process.env.MAX_LIVE_RUNS_PER_ROOM_PER_HOUR;
  resetRunBudget();
  removeFakeModel();
});

describe("Kai, played by a model", () => {
  it("is told his own taste and limit and shown only the card", async () => {
    const model = installFakeModel([{ calls: [{ name: "answer_card", args: { choice: "accept" } }] }]);
    const result = await memberDecides("kai", plan);
    expect(result.choice).toBe("accept");
    expect(model.calls).toHaveLength(1);
    const sent = JSON.stringify(model.calls[0]);
    expect(sent).toContain("Kai");
    expect(sent).toContain("Pebble");
    expect(sent).toContain("anime");
    expect(sent).toContain("low mobility");
    expect(sent).toContain("Shawarma Point");
    expect(sent).not.toMatch(/Family wedding|Weekend away|Northwind|Interview|Physical therapy|Michelle|calendar/);
  });

  it("can decline, and never fakes a decision when the model does not answer", async () => {
    installFakeModel([{ calls: [{ name: "answer_card", args: { choice: "decline" } }] }]);
    expect((await memberDecides("kai", plan)).choice).toBe("decline");
    installFakeModel([{ text: "I would love to go!" }, { text: "Still no tool." }]);
    await expect(memberDecides("kai", plan)).rejects.toThrow();
  });

  it("keeps Michelle's profile as hers, with no limit to mention", () => {
    expect(memberInstructions("lisa")).toContain("food, every cuisine");
    expect(memberInstructions("lisa")).not.toContain("low mobility");
  });
});

describe("Kai's answer over the route", () => {
  it("refuses when the room has real people, so Kai answers from the coordinator's phone", async () => {
    const model = installFakeModel([]);
    expect((await answer(await postMember(json({ planId: plan.id })))).status).toBe(409);
    expect(model.calls).toHaveLength(0);
    expect((await store.getPlan(plan.id))?.group?.decisions.kai).toBe("pending");
  });

  it("answers once with a real model call; a second ask finds nothing waiting", async () => {
    await store.putRoom({ ...(await store.getRoom()), simulatedFriend: true });
    const model = installFakeModel([{ calls: [{ name: "answer_card", args: { choice: "accept" } }] }]);
    const first = await answer(await postMember(json({ planId: plan.id })));
    expect(first.status).toBe(200);
    expect((await store.getPlan(plan.id))?.group?.decisions).toMatchObject({ kai: "accepted", aaron: "pending", lisa: "pending" });
    expect(model.calls).toHaveLength(1);
    expect((await answer(await postMember(json({ planId: plan.id })))).status).toBe(409);
  }, 15_000);

  it("answers 502 and records nothing when the model does not answer", async () => {
    await store.putRoom({ ...(await store.getRoom()), simulatedFriend: true });
    installFakeModel([{ text: "sure" }, { text: "sure" }]);
    expect((await answer(await postMember(json({ planId: plan.id })))).status).toBe(502);
    expect((await store.getPlan(plan.id))?.group?.decisions.kai).toBe("pending");
  }, 15_000);

  it("takes a live-run slot, and past the cap makes no model call: 429 paused, the card stays pending", async () => {
    await store.putRoom({ ...(await store.getRoom()), simulatedFriend: true });
    installFakeModel([{ calls: [{ name: "answer_card", args: { choice: "accept" } }] }]);
    await postMember(json({ planId: plan.id }));
    expect(runBudget().room.used).toBe(1);

    process.env.MAX_LIVE_RUNS_PER_ROOM_PER_HOUR = "0";
    await store.putPlan({ ...(await store.getPlan(plan.id))!, group: { ...plan.group!, decisions: { aaron: "pending", lisa: "pending", kai: "pending" } } });
    const model = installFakeModel([]);
    const paused = await postMember(json({ planId: plan.id }));
    expect(paused.status).toBe(429);
    expect(await paused.json()).toMatchObject({ paused: true, text: "Live runs paused, playing a recording" });
    expect(model.calls).toHaveLength(0);
  }, 15_000);

  it("one judge alone: Michelle and Kai are both played by a model, and the judge's yes confirms the plan for three", async () => {
    await store.putRoom({ ...(await store.getRoom()), simulatedFriend: true });
    installFakeModel([
      { calls: [{ name: "answer_card", args: { choice: "accept" } }] },
      { calls: [{ name: "answer_card", args: { choice: "accept" } }] },
    ]);
    expect((await answer(await postFriend(json({ planId: plan.id })))).status).toBe(200);
    expect((await answer(await postMember(json({ planId: plan.id })))).status).toBe(200);
    const waiting = await store.getPlan(plan.id);
    expect(waiting?.state).toBe("awaiting_humans");
    expect(waiting?.group?.decisions).toMatchObject({ lisa: "accepted", kai: "accepted", aaron: "pending" });

    const result = await decide(store, { planId: plan.id, agent: "aaron", choice: "accept" });
    expect(result.ok && result.value.plan.state).toBe("confirmed");
  }, 20_000);

  it("a model that plays Kai can say no, and that drops the plan for all three", async () => {
    await store.putRoom({ ...(await store.getRoom()), simulatedFriend: true });
    installFakeModel([{ calls: [{ name: "answer_card", args: { choice: "decline" } }] }]);
    expect((await answer(await postMember(json({ planId: plan.id })))).status).toBe(200);
    expect((await store.getPlan(plan.id))?.state).toBe("dropped");
  }, 15_000);
});
