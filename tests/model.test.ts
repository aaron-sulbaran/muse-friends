import { afterEach, describe, expect, it } from "vitest";
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
      { responseId: "resp_1", model: "muse-spark-1.3", call: expect.objectContaining({ responseId: "resp_1", inputTokens: 10, outputTokens: 5, reasoningTokens: 2, toolNames: ["get_my_calendar"] }) },
    ]);
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

  it("fails with cap_reached after one nudge that still gets no tool call", async () => {
    const fake = installFakeModel([{ text: "prose" }, { text: "more prose" }, { text: "unused" }]);
    const result = await runAgentTurn({ ...base, handlers: {}, requiredTools: ["send_to_friend_agent"] });
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({ reason: "cap_reached", detail: "no_tool_call" });
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
    expect(result.failure).toMatchObject({ reason: "cap_reached", detail: "api_error" });
  });
});

describe("a model_not_found flap on the Meta API", () => {
  it("retries a 404 model_not_found on a stateless call and carries on", async () => {
    const fake = installFakeModel([{ error: 404, code: "model_not_found" }, { error: 404, code: "model_not_found" }, { text: "done" }]);
    const result = await runAgentTurn({ ...base, handlers: {} });
    expect(result.status).toBe("completed");
    expect(fake.calls).toHaveLength(3);
  });

  it("gives up after the retries and reports the API error", async () => {
    installFakeModel(Array.from({ length: 6 }, () => ({ error: 404, code: "model_not_found" })));
    const result = await runAgentTurn({ ...base, handlers: {} });
    expect(result.status).toBe("failed");
    expect(result.failure).toMatchObject({ detail: "api_error", message: expect.stringContaining("model was not found") });
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
