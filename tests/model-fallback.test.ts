import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeFailure, injectSignal, runSignalTurn } from "@/lib/agent/runtime";
import { notFoundTailMs, runAgentTurn, type ToolDefinition } from "@/lib/model";
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
  process.env.MODEL_404_TAIL_MS = "0";
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

// Meta's whole endpoint can answer 404 on every model for ten to thirty seconds, instantly, so time and not calls rides it out.
// After the ladder, one more try of each model (the configured one first) every 2 seconds for up to MODEL_404_TAIL_MS.
// The tests shrink the pauses (MODEL_RETRY_SCALE 0) but still run every tick: 6 s of burst is three ticks.
describe("the slow tail after a 404 burst", () => {
  const ladder = Array.from({ length: 10 }, () => notFound); // 4 on the configured model, 6 on the fallback

  it("ends with proof from the configured model and no scripted turn when the burst clears at 6 seconds", async () => {
    process.env.MODEL_404_TAIL_MS = "20000";
    // Ticks at 2 s and 4 s fail on both models; the configured model answers at 6 s.
    const fake = installFakeModel([...ladder, notFound, notFound, notFound, notFound, { text: "Hello." }]);
    const result = await runAgentTurn({ ...base, handlers: {} });
    expect(result.status).toBe("completed");
    expect(fake.calls).toHaveLength(15);
    expect(modelsCalled(fake.calls).slice(10)).toEqual(["muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.3", "muse-spark-1.2", "muse-spark-1.3"]);
    expect(result.calls[0].model).toBe("muse-spark-1.3");
    expect(result.calls[0].fallbackFrom).toBeUndefined();
  });

  it("lets the fallback answer if it is the one that comes back first", async () => {
    process.env.MODEL_404_TAIL_MS = "20000";
    installFakeModel([...ladder, notFound, { text: "Hello." }]);
    const result = await runAgentTurn({ ...base, handlers: {} });
    expect(result.status).toBe("completed");
    expect(result.calls[0]).toMatchObject({ model: "muse-spark-1.2", fallbackFrom: "muse-spark-1.3" });
  });

  it("sends the message from the configured model with its proof, not a scripted turn", async () => {
    process.env.MODEL_404_TAIL_MS = "20000";
    const store = new JsonStore(null);
    const { contextId } = await injectSignal(store, { ...rawShawarmaSignal(), id: "sig_tail" });
    installFakeModel([
      ...ladder,
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
    const result = await runSignalTurn({ store, agent: "aaron", signalId: "sig_tail", contextId });
    expect(result.fallback).toBeUndefined();
    const [record] = await store.listMessages(contextId);
    expect(record.proof).toMatchObject({ model: "muse-spark-1.3" });
    expect(record.proof?.fallbackFrom).toBeUndefined();
  });

  it("ends with the scripted turn and the honest reason when the burst outlasts the tail (20 s by default)", async () => {
    delete process.env.MODEL_404_TAIL_MS;
    const fake = installFakeModel(Array.from({ length: 60 }, () => notFound));
    const result = await runAgentTurn({ ...base, handlers: {} });
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({ reason: "model_error", detail: "api_error", message: expect.stringContaining("not found") });
    // The ladder (10 calls), then ten ticks of two models: 20 s at one tick every 2 s.
    expect(fake.calls).toHaveLength(30);

    removeFakeModel();
    process.env.MODEL_404_TAIL_MS = "6000";
    installFakeModel(Array.from({ length: 60 }, () => notFound));
    const store = new JsonStore(null);
    const { contextId } = await injectSignal(store, { ...rawShawarmaSignal(), id: "sig_tail2" });
    const turn = await runSignalTurn({ store, agent: "aaron", signalId: "sig_tail2", contextId });
    expect(turn.fallback).toBe(true);
    expect(turn.failure).toMatchObject({ reason: "model_error", message: expect.stringContaining("not found") });
    expect((await store.listMessages(contextId))[0].proof).toBeUndefined();
  });

  it("is never taken for a 429, a 5xx or any other error, and can be switched off", async () => {
    process.env.MODEL_404_TAIL_MS = "20000";
    for (const status of [429, 500, 503, 400]) {
      removeFakeModel();
      // The ladder ends the 404s, then the first tick gets the other error and the call ends there.
      const fake = installFakeModel([...ladder, { error: status }, notFound, notFound]);
      const result = await runAgentTurn({ ...base, handlers: {} });
      expect(result.status).toBe("failed");
      expect(result.failure?.message ?? "", String(status)).not.toContain("not found");
      expect(fake.calls, String(status)).toHaveLength(11);
    }

    removeFakeModel();
    process.env.MODEL_404_TAIL_MS = "0";
    const off = installFakeModel(Array.from({ length: 30 }, () => notFound));
    await runAgentTurn({ ...base, handlers: {} });
    expect(off.calls).toHaveLength(10);
  });

  it("reads MODEL_404_TAIL_MS as milliseconds, 20000 by default, 0 for off, and ignores nonsense", () => {
    delete process.env.MODEL_404_TAIL_MS;
    expect(notFoundTailMs()).toBe(20_000);
    for (const [raw, expected] of [["25000", 25_000], ["0", 0], ["6000", 6000], ["", 20_000], ["abc", 20_000], ["-5", 20_000], ["1500.9", 1500]] as const) {
      process.env.MODEL_404_TAIL_MS = raw;
      expect(notFoundTailMs(), raw).toBe(expected);
    }
  });
});

// The next 404 burst should hand the Meta reps request ids: the x-request-id of each failed call goes on the log line.
describe("request ids on the 'did not answer' log line", () => {
  const withIds = (count: number, prefix = "req_"): Step[] => Array.from({ length: count }, (_, index) => ({ error: 404, code: "model_not_found", requestId: `${prefix}${index + 1}` }));

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("keeps the id of every failed call of a burst on the turn's failure, oldest first", async () => {
    installFakeModel(withIds(12));
    const result = await runAgentTurn({ ...base, handlers: {} });
    // 4 calls on the configured model and 6 on the fallback.
    expect(result.failure?.requestIds).toEqual(Array.from({ length: 10 }, (_, index) => `req_${index + 1}`));
    expect(describeFailure(result.failure)).toBe("the model did not answer (404 The requested model was not found.; request ids req_1 to req_10, 10 calls)");
  });

  it("includes the tail's calls too, and the single id of a plain 5xx", async () => {
    process.env.MODEL_404_TAIL_MS = "2000";
    installFakeModel(withIds(30));
    const burst = await runAgentTurn({ ...base, handlers: {} });
    // The ladder (10) and one tick of both models (2).
    expect(burst.failure?.requestIds).toHaveLength(12);
    expect(describeFailure(burst.failure)).toContain("request ids req_1 to req_12, 12 calls");

    removeFakeModel();
    installFakeModel([{ error: 503, requestId: "req_503" }]);
    const single = await runAgentTurn({ ...base, handlers: {} });
    expect(single.failure?.requestIds).toEqual(["req_503"]);
    expect(describeFailure(single.failure)).toMatch(/\(503 .*; request id req_503\)$/);
  });

  it("says nothing about ids when the API sent none", async () => {
    installFakeModel(Array.from({ length: 12 }, () => notFound));
    const result = await runAgentTurn({ ...base, handlers: {} });
    expect(result.failure?.requestIds).toBeUndefined();
    expect(describeFailure(result.failure)).not.toContain("request id");
  });

  it("puts the ids on the server log line, with whether the scripted fallback spoke", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const store = new JsonStore(null);
    const { contextId } = await injectSignal(store, { ...rawShawarmaSignal(), id: "sig_ids" });
    installFakeModel(withIds(12));
    const turn = await runSignalTurn({ store, agent: "aaron", signalId: "sig_ids", contextId });
    expect(turn.fallback).toBe(true);
    expect(error).toHaveBeenCalledWith("agent turn failed (aaron): the model did not answer (404 The requested model was not found.; request ids req_1 to req_10, 10 calls); the scripted fallback spoke");
    // The model switch is logged with the id of the 404 that caused it.
    expect(warn).toHaveBeenCalledWith("model muse-spark-1.3 answered 404 model_not_found (request id req_4); trying muse-spark-1.2");
  });

  it("logs the id of the last 404 when the slow tail starts", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.MODEL_404_TAIL_MS = "2000";
    installFakeModel(withIds(30));
    await runAgentTurn({ ...base, handlers: {} });
    expect(warn).toHaveBeenCalledWith("every model answered 404 model_not_found (request id req_10); retrying every 2s for up to 2s");
  });
});

describe("the tail length is read when the call is made", () => {
  it("a changed MODEL_404_TAIL_MS applies to the next call without reloading anything", async () => {
    process.env.MODEL_404_TAIL_MS = "6000";
    const first = installFakeModel(Array.from({ length: 60 }, () => notFound));
    await runAgentTurn({ ...base, handlers: {} });
    expect(first.calls).toHaveLength(16); // the ladder (10) and three ticks of both models

    removeFakeModel();
    process.env.MODEL_404_TAIL_MS = "2000";
    const second = installFakeModel(Array.from({ length: 60 }, () => notFound));
    await runAgentTurn({ ...base, handlers: {} });
    expect(second.calls).toHaveLength(12); // the ladder and one tick
  });
});
