import { describeFailure } from "@/lib/agent/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runAgentTurn, type ToolDefinition } from "@/lib/model";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";

const tool = (name: string): ToolDefinition => ({ name, description: name, parameters: { type: "object", properties: {} } });
const base = { instructions: "You are Sprout.", input: "Go.", tools: [tool("get_my_calendar"), tool("send_to_friend_agent")] };

afterEach(() => {
  removeFakeModel();
  delete process.env.MODEL_CHAIN_MODE;
});

describe("runAgentTurn (stateless, the default)", () => {
  it("runs a tool, returns its output by call_id, and resends instructions, tools, and effort every call", async () => {
    const fake = installFakeModel([{ calls: [{ name: "get_my_calendar", args: { start: "x" } }] }, { text: "Done." }]);
    const seen: unknown[] = [];
    const result = await runAgentTurn({ ...base, handlers: { get_my_calendar: async (args) => (seen.push(args), { free: [] }) } });

    expect(result.status).toBe("completed");
    expect(result.finalText).toBe("Done.");
    expect(seen).toEqual([{ start: "x" }]);
    expect(fake.calls).toHaveLength(2);
    for (const call of fake.calls) {
      expect(call.instructions).toBe("You are Sprout.");
      expect((call.tools as unknown[]).length).toBe(2);
      expect(call.reasoning).toEqual({ effort: "low" });
      expect(call.temperature).toBeUndefined();
      expect(call.store).toBe(false);
      expect(call.include).toEqual(["reasoning.encrypted_content"]);
      expect(call.previous_response_id).toBeUndefined();
    }
    const second = fake.calls[1].input as Array<Record<string, unknown>>;
    expect(second.map((item) => item.type ?? item.role)).toEqual(["user", "reasoning", "function_call", "function_call_output"]);
    expect(second[3]).toMatchObject({ type: "function_call_output", call_id: "call_1_0", output: JSON.stringify({ free: [] }) });
  });

  it("tells each handler which model call asked for it", async () => {
    installFakeModel([{ calls: [{ name: "get_my_calendar", args: {} }] }, { text: "ok" }]);
    const metas: unknown[] = [];
    await runAgentTurn({ ...base, handlers: { get_my_calendar: async (_args, meta) => (metas.push(meta), {}) } });
    expect(metas).toEqual([
      { responseId: "resp_1", model: "muse-spark-1.3", call: expect.objectContaining({ responseId: "resp_1", inputTokens: 10, outputTokens: 5, reasoningTokens: 2, toolNames: ["get_my_calendar"] }), toolCalls: [], callId: "call_1_0", finishedCalls: [] },
    ]);
  });

  it("tells each handler the tool calls the turn has already finished, summarized, and leaves what the model sees alone", async () => {
    const fake = installFakeModel([
      { calls: [{ name: "get_my_calendar", args: { start: "2026-10-26T00:00:00-05:00", end: "2026-10-27" } }, { name: "get_interests", args: { category: "food" } }] },
      { calls: [{ name: "send_to_friend_agent", args: { type: "intent", windows: [{}, {}], share: ["food", "location"] } }] },
      { text: "done" },
    ]);
    const seen: Array<[string, unknown]> = [];
    await runAgentTurn({
      ...base,
      handlers: {
        get_my_calendar: async (_args, meta) => (seen.push(["get_my_calendar", meta?.toolCalls]), { free: [{}, {}, {}], busy: [{ title: "Interview, Northwind Labs", private: true }] }),
        get_interests: async (_args, meta) => (seen.push(["get_interests", meta?.toolCalls]), { food: ["shawarma", "ramen"] }),
        send_to_friend_agent: async (_args, meta) => (seen.push(["send", meta?.toolCalls]), { ok: true, seq: 1, state: "working" }),
      },
    });
    expect(seen[0][1]).toEqual([]);
    expect(seen[1][1]).toEqual([{ name: "get_my_calendar", args: "2026-10-26 to 2026-10-27", result: "3 free blocks, 1 busy" }]);
    expect(seen[2][1]).toEqual([
      { name: "get_my_calendar", args: "2026-10-26 to 2026-10-27", result: "3 free blocks, 1 busy" },
      { name: "get_interests", args: "food", result: "2 interests" },
    ]);
    // Private titles never reach the summaries.
    expect(JSON.stringify(seen)).not.toMatch(/Northwind|Interview/);
    // The model is told exactly what it was told before: the raw tool outputs, nothing about the summaries.
    const second = fake.calls[1].input as Array<Record<string, unknown>>;
    const outputs = second.filter((item) => item.type === "function_call_output").map((item) => String(item.output));
    expect(outputs[0]).toBe(JSON.stringify({ free: [{}, {}, {}], busy: [{ title: "Interview, Northwind Labs", private: true }] }));
    expect(JSON.stringify(fake.calls)).not.toContain("3 free blocks");
  });

  it("sends function tools with strict false and no tool_choice", async () => {
    const fake = installFakeModel([{ text: "ok" }]);
    await runAgentTurn({ ...base, handlers: {} });
    expect((fake.calls[0].tools as Array<Record<string, unknown>>)[0]).toMatchObject({ type: "function", strict: false });
    expect(fake.calls[0].tool_choice).toBeUndefined();
  });

  it("hands tool errors back to the model instead of throwing", async () => {
    const fake = installFakeModel([
      { calls: [{ name: "get_my_calendar", args: "not json" }, { name: "mystery", args: {} }] },
      { text: "ok" },
    ]);
    const result = await runAgentTurn({
      ...base,
      handlers: {
        get_my_calendar: async (args) => {
          if (typeof args === "string") throw new Error("bad json");
          return {};
        },
      },
    });
    expect(result.status).toBe("completed");
    expect(result.toolCalls.map((call) => call.ok)).toEqual([false, false]);
    const outputs = (fake.calls[1].input as Array<Record<string, unknown>>).filter((item) => item.type === "function_call_output");
    expect(outputs.map((item) => JSON.parse(item.output as string))).toEqual([{ error: "bad json" }, { error: "unknown tool mystery" }]);
  });

  it("stops at the tool-call cap", async () => {
    installFakeModel(Array.from({ length: 10 }, () => ({ calls: [{ name: "get_my_calendar", args: {} }] })));
    const result = await runAgentTurn({
      ...base,
      handlers: { get_my_calendar: async () => ({}) },
      requiredTools: ["send_to_friend_agent"],
      maxToolCalls: 3,
    });
    expect(result.toolCalls).toHaveLength(3);
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({ reason: "cap_reached", detail: "tool_cap" });
  });

  it("allows up to six tool calls by default", async () => {
    installFakeModel([
      { calls: Array.from({ length: 6 }, () => ({ name: "get_my_calendar", args: {} })) },
      { text: "done" },
    ]);
    const result = await runAgentTurn({ ...base, handlers: { get_my_calendar: async () => ({}) } });
    expect(result.toolCalls).toHaveLength(6);
    expect(result.status).toBe("completed");
  });

  it("ends the turn as soon as a required tool succeeds", async () => {
    const fake = installFakeModel([{ calls: [{ name: "send_to_friend_agent", args: {} }] }, { text: "never asked for" }]);
    const result = await runAgentTurn({ ...base, handlers: { send_to_friend_agent: async () => ({ ok: true }) }, requiredTools: ["send_to_friend_agent"] });
    expect(result.status).toBe("completed");
    expect(fake.calls).toHaveLength(1);
  });

  it("does not count a failed required tool as done", async () => {
    installFakeModel([
      { calls: [{ name: "send_to_friend_agent", args: {} }] },
      { calls: [{ name: "send_to_friend_agent", args: {} }] },
    ]);
    let attempt = 0;
    const result = await runAgentTurn({
      ...base,
      handlers: { send_to_friend_agent: async () => (attempt += 1) === 1 ? { error: "fix it" } : { ok: true } },
      requiredTools: ["send_to_friend_agent"],
    });
    expect(result.status).toBe("completed");
    expect(result.toolCalls.map((call) => call.ok)).toEqual([false, true]);
  });

  it("nudges once when the model answers in prose, then succeeds", async () => {
    const fake = installFakeModel([{ text: "I would send a message." }, { calls: [{ name: "send_to_friend_agent", args: {} }] }]);
    const result = await runAgentTurn({ ...base, handlers: { send_to_friend_agent: async () => ({ ok: true }) }, requiredTools: ["send_to_friend_agent"] });
    expect(result.status).toBe("completed");
    expect(result.nudged).toBe(true);
    const nudge = (fake.calls[1].input as Array<Record<string, unknown>>).at(-1);
    expect(nudge).toMatchObject({ role: "user" });
  });

  it("fails with no_tool_call after one nudge that still gets no tool call", async () => {
    const fake = installFakeModel([{ text: "prose" }, { text: "more prose" }, { text: "unused" }]);
    const result = await runAgentTurn({ ...base, handlers: {}, requiredTools: ["send_to_friend_agent"] });
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({ reason: "no_tool_call", detail: "no_tool_call" });
    expect(fake.calls).toHaveLength(2);
  });

  it("treats prose as fine when no tool is required", async () => {
    installFakeModel([{ text: "Just an answer." }]);
    const result = await runAgentTurn({ ...base, handlers: {} });
    expect(result.status).toBe("completed");
    expect(result.nudged).toBe(false);
  });

  it("retries once without reasoning items when stateless replay is rejected with a 400", async () => {
    const fake = installFakeModel([
      { calls: [{ name: "get_my_calendar", args: {} }] },
      { error: 400 },
      { text: "ok" },
    ]);
    const result = await runAgentTurn({ ...base, handlers: { get_my_calendar: async () => ({}) } });
    expect(result.status).toBe("completed");
    const retried = fake.calls[2].input as Array<Record<string, unknown>>;
    expect(retried.some((item) => item.type === "reasoning")).toBe(false);
    expect(retried.some((item) => item.type === "function_call_output")).toBe(true);
  });

  it("reports an API failure as a failed turn, not an exception", async () => {
    installFakeModel([{ error: 500 }]);
    const result = await runAgentTurn({ ...base, handlers: {} });
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({ reason: "model_error", detail: "api_error" });
  });

  it("calls a model that answered 404 through every retry a model error, never a cap", async () => {
    process.env.MODEL_RETRY_SCALE = "0";
    // The first call and each of the eight retries answer 404 model_not_found.
    installFakeModel(Array.from({ length: 9 }, () => ({ error: 404, code: "model_not_found" })));
    const result = await runAgentTurn({ ...base, handlers: {} });
    delete process.env.MODEL_RETRY_SCALE;
    expect(result.failure).toMatchObject({ reason: "model_error", detail: "api_error", message: expect.stringContaining("not found") });
    expect(describeFailure(result.failure)).toMatch(/^the model did not answer \(.*not found/);
    expect(describeFailure(result.failure)).not.toMatch(/cap/);
    expect(describeFailure({ reason: "cap_reached", detail: "tool_cap" })).toBe("the model used up its tool calls for the turn");
    expect(describeFailure({ reason: "no_tool_call", detail: "no_tool_call" })).toBe("the model replied without acting, even after a nudge");
  });
});

describe("a model_not_found flap on the Meta API", () => {
  beforeEach(() => {
    process.env.MODEL_RETRY_SCALE = "0";
  });
  afterEach(() => {
    delete process.env.MODEL_RETRY_SCALE;
  });

  it("retries a 404 model_not_found on a stateless call and carries on", async () => {
    const fake = installFakeModel([{ error: 404, code: "model_not_found" }, { error: 404, code: "model_not_found" }, { text: "done" }]);
    const result = await runAgentTurn({ ...base, handlers: {} });
    expect(result.status).toBe("completed");
    expect(fake.calls).toHaveLength(3);
  });

  it("rides out eight 404s in a row before a valid reply", async () => {
    const fake = installFakeModel([...Array.from({ length: 8 }, () => ({ error: 404, code: "model_not_found" })), { text: "done" }]);
    const result = await runAgentTurn({ ...base, handlers: {} });
    expect(result.status).toBe("completed");
    expect(fake.calls).toHaveLength(9);
  });

  it("retries a flap on a later call of the turn too", async () => {
    const fake = installFakeModel([
      { calls: [{ name: "get_my_calendar", args: {} }] },
      ...Array.from({ length: 5 }, () => ({ error: 404, code: "model_not_found" })),
      { text: "done" },
    ]);
    const result = await runAgentTurn({ ...base, handlers: { get_my_calendar: async () => ({}) } });
    expect(result.status).toBe("completed");
    expect(fake.calls).toHaveLength(7);
  });

  it("gives up after the retries and reports the API error", async () => {
    // No fallback model here: the whole ladder is spent on the configured one (tests/model-fallback.test.ts covers the chain).
    process.env.MODEL_FALLBACK_IDS = "";
    const fake = installFakeModel(Array.from({ length: 12 }, () => ({ error: 404, code: "model_not_found" })));
    const result = await runAgentTurn({ ...base, handlers: {} });
    delete process.env.MODEL_FALLBACK_IDS;
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({ detail: "api_error", message: expect.stringContaining("model was not found") });
    expect(fake.calls).toHaveLength(9);
  });

  it("does not retry a plain 404 that is not model_not_found", async () => {
    const fake = installFakeModel([{ error: 404 }, { text: "unused" }]);
    const result = await runAgentTurn({ ...base, handlers: {} });
    expect(result.status).toBe("failed");
    expect(fake.calls).toHaveLength(1);
  });
});

describe("runAgentTurn (chain mode, the TECH_SPEC fallback)", () => {
  it("sends only new items with previous_response_id and still resends instructions, tools, and effort", async () => {
    const fake = installFakeModel([{ calls: [{ name: "get_my_calendar", args: {} }] }, { text: "done" }]);
    await runAgentTurn({ ...base, handlers: { get_my_calendar: async () => ({}) }, mode: "chain" });
    expect(fake.calls[0].previous_response_id).toBeUndefined();
    expect(fake.calls[1].previous_response_id).toBe("resp_1");
    expect(fake.calls[1].instructions).toBe("You are Sprout.");
    expect(fake.calls[1].reasoning).toEqual({ effort: "low" });
    expect(fake.calls[1].store).toBeUndefined();
    expect((fake.calls[1].input as unknown[]).length).toBe(1);
  });

  it("retries a brief 400 or 404 on a chained call", async () => {
    const fake = installFakeModel([{ calls: [{ name: "get_my_calendar", args: {} }] }, { error: 404 }, { error: 400 }, { text: "done" }]);
    const result = await runAgentTurn({ ...base, handlers: { get_my_calendar: async () => ({}) }, mode: "chain" });
    expect(result.status).toBe("completed");
    expect(result.calls[1].chainRetries).toBe(2);
    expect(fake.calls).toHaveLength(4);
  });

  it("is selectable with MODEL_CHAIN_MODE", async () => {
    process.env.MODEL_CHAIN_MODE = "chain";
    const fake = installFakeModel([{ calls: [{ name: "get_my_calendar", args: {} }] }, { text: "done" }]);
    await runAgentTurn({ ...base, handlers: { get_my_calendar: async () => ({}) } });
    expect(fake.calls[1].previous_response_id).toBe("resp_1");
  });
});
