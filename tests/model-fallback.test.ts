import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeFailure, injectSignal, runSignalTurn } from "@/lib/agent/runtime";
import { runAgentTurn, type ToolDefinition } from "@/lib/model";
import { rawShawarmaSignal } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import { installFakeModel, removeFakeModel, type Step } from "./helpers/fakeModel";

// Meta's model flaps: muse-spark-1.3 can answer "404 model not found" on every call while muse-spark-1.2 answers.
// When the configured model keeps answering 404, the same call moves to the next model; a 429 or a 5xx never does.

const tool = (name: string): ToolDefinition => ({ name, description: name, parameters: { type: "object", properties: {} } });
const base = { instructions: "You are Sprout.", input: "Go.", tools: [tool("get_my_calendar")] };
const notFound: Step = { error: 404, code: "model_not_found" };
const modelsCalled = (calls: Array<Record<string, unknown>>) => calls.map((call) => call.model);

beforeEach(() => {
  process.env.MODEL_RETRY_SCALE = "0";
  delete process.env.MODEL_ID;
  delete process.env.MODEL_FALLBACK_IDS;
});
afterEach(() => {
  removeFakeModel();
  delete process.env.MODEL_RETRY_SCALE;
  delete process.env.MODEL_ID;
  delete process.env.MODEL_FALLBACK_IDS;
});

describe("the model fallback chain", () => {
  it("retries the same call on muse-spark-1.2 once muse-spark-1.3 has used its share of the ladder, and says who answered", async () => {
    // The configured model gets the first call and three retries; the fourth 404 hands the call to the fallback.
    const fake = installFakeModel([notFound, notFound, notFound, notFound, { text: "Hello." }]);
    const result = await runAgentTurn({ ...base, handlers: {} });
    expect(result.status).toBe("completed");
    expect(modelsCalled(fake.calls)).toEqual(["muse-spark-1.3", "muse-spark-1.3", "muse-spark-1.3", "muse-spark-1.3", "muse-spark-1.2"]);
    expect(result.calls[0]).toMatchObject({ model: "muse-spark-1.2", fallbackFrom: "muse-spark-1.3" });
  });

  it("does not leave the configured model for a flap that clears within its share", async () => {
    const fake = installFakeModel([notFound, notFound, { text: "Hello." }]);
    const result = await runAgentTurn({ ...base, handlers: {} });
    expect(modelsCalled(fake.calls)).toEqual(["muse-spark-1.3", "muse-spark-1.3", "muse-spark-1.3"]);
    expect(result.calls[0].model).toBe("muse-spark-1.3");
    expect(result.calls[0].fallbackFrom).toBeUndefined();
  });

  it("keeps the rest of the turn on the model that answered, and the next turn starts on the configured one again", async () => {
    const fake = installFakeModel([notFound, notFound, notFound, notFound, { calls: [{ name: "get_my_calendar", args: {} }] }, { text: "Done." }]);
    const result = await runAgentTurn({ ...base, handlers: { get_my_calendar: async () => ({ free: [] }) } });
    expect(result.status).toBe("completed");
    expect(modelsCalled(fake.calls).slice(3)).toEqual(["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.2"]);
    expect(result.calls.map((call) => call.model)).toEqual(["muse-spark-1.2", "muse-spark-1.2"]);

    removeFakeModel();
    const next = installFakeModel([{ text: "Hi." }]);
    await runAgentTurn({ ...base, handlers: {} });
    expect(modelsCalled(next.calls)).toEqual(["muse-spark-1.3"]);
  });

  it("fails the turn as today when both models answer 404, using about the same ladder (one more call, the same pauses)", async () => {
    const fake = installFakeModel(Array.from({ length: 12 }, () => notFound));
    const result = await runAgentTurn({ ...base, handlers: {} });
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({ detail: "api_error", message: expect.stringContaining("not found") });
    // 1 + 3 retries on the configured model, then 1 + 5 retries on the fallback: the 8 pauses of the ladder, not 16.
    expect(modelsCalled(fake.calls)).toEqual([...Array(4).fill("muse-spark-1.3"), ...Array(6).fill("muse-spark-1.2")]);
  });

  it("reports a model_error with the API's own words when every model in the chain answers 404, never a cap", async () => {
    // Enough steps for both models to use their whole share, so the failure is the 404 and not a fake that ran dry.
    installFakeModel(Array.from({ length: 12 }, () => notFound));
    const result = await runAgentTurn({ ...base, handlers: {} });
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({ reason: "model_error", detail: "api_error", message: expect.stringContaining("not found") });
    expect(result.failure?.message).not.toContain("ran out of steps");
    expect(describeFailure(result.failure)).toMatch(/^the model did not answer \(.*not found/);
    expect(describeFailure(result.failure)).not.toMatch(/cap/);
  });

  it("does not switch models for a 429 or a 5xx", async () => {
    for (const status of [429, 500, 503]) {
      removeFakeModel();
      const fake = installFakeModel([{ error: status }, { text: "never reached" }]);
      const result = await runAgentTurn({ ...base, handlers: {} });
      expect(result.status).toBe("failed");
      expect(modelsCalled(fake.calls)).toEqual(["muse-spark-1.3"]);
    }
  });

  it("uses the whole ladder on the configured model when there is no fallback, and honors MODEL_ID and MODEL_FALLBACK_IDS", async () => {
    process.env.MODEL_FALLBACK_IDS = "";
    const none = installFakeModel(Array.from({ length: 12 }, () => notFound));
    await runAgentTurn({ ...base, handlers: {} });
    expect(modelsCalled(none.calls)).toEqual(Array(9).fill("muse-spark-1.3"));

    removeFakeModel();
    process.env.MODEL_ID = "model-a";
    process.env.MODEL_FALLBACK_IDS = "model-b, model-a, model-c";
    const chain = installFakeModel([notFound, notFound, notFound, notFound, notFound, notFound, notFound, notFound, { text: "ok" }]);
    const result = await runAgentTurn({ ...base, handlers: {} });
    // model-a is not its own fallback; model-b gets 3 retries after it, then model-c takes the rest.
    expect(modelsCalled(chain.calls)).toEqual(["model-a", "model-a", "model-a", "model-a", "model-b", "model-b", "model-b", "model-b", "model-c"]);
    expect(result.calls[0]).toMatchObject({ model: "model-c", fallbackFrom: "model-a" });
  });
});

describe("what a fallback answer looks like to the rest of the app", () => {
  it("sends the message with proof from the model that answered, with no scripted turn", async () => {
    const store = new JsonStore(null);
    const { contextId, planId } = await injectSignal(store, { ...rawShawarmaSignal(), id: "sig_fb" });
    const signalId = "sig_fb";
    installFakeModel([
      notFound,
      notFound,
      notFound,
      notFound,
      {
        calls: [
          {
            name: "send_to_friend_agent",
            args: { friend: "lisa", type: "intent", reason: "interest_match", activity: { kind: "food", title: "Shawarma Point", place: "E 6th St" }, windows: [{ start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" }], note: "Want to go this week?" },
          },
        ],
      },
    ]);
    const result = await runSignalTurn({ store, agent: "aaron", signalId, contextId });
    expect(result.fallback).toBeUndefined();
    const [record] = await store.listMessages(contextId);
    expect(record.proof).toMatchObject({ model: "muse-spark-1.2", fallbackFrom: "muse-spark-1.3" });
    expect(planId).toBeTruthy();
  });

  it("still sends the scripted turn when every model answers 404, as before", async () => {
    const store = new JsonStore(null);
    const { contextId } = await injectSignal(store, { ...rawShawarmaSignal(), id: "sig_fb2" });
    installFakeModel(Array.from({ length: 12 }, () => notFound));
    const result = await runSignalTurn({ store, agent: "aaron", signalId: "sig_fb2", contextId });
    expect(result.fallback).toBe(true);
    const [record] = await store.listMessages(contextId);
    expect(record.proof).toBeUndefined();
  });
});
