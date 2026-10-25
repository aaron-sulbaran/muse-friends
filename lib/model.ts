import OpenAI from "openai";
import { summarizeToolCall, type ToolCallSummary } from "./tool-summary";
import type {
  FunctionTool,
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseInput,
} from "openai/resources/responses/responses";

type InputItem = ResponseInput[number];

// The one place that knows the provider. Everything else calls runAgentTurn().

export const DEFAULT_BASE_URL = "https://api.meta.ai/v1";
export const DEFAULT_MODEL = "muse-spark-1.3";
export const MAX_TOOL_CALLS_PER_TURN = 6;

const CHAIN_RETRY_DELAYS_MS = [400, 800, 1600];
// The Meta API answers a fraction of calls with 404 model_not_found while the model is perfectly available
// (about one in four during the C5 rehearsal, and it answers in about 0.2 s). It is a routing flap on their
// side; the next call goes through, but a single call can see several in a row. Eight short retries cost
// nothing normally and at most 6 s when the flap is at its worst.
const MODEL_NOT_FOUND_RETRY_DELAYS_MS = [200, 300, 400, 600, 800, 1000, 1200, 1500];
// When a fallback model exists, the configured one gets only the first of those retries (a flap clears in one or two
// tries when it is a flap); then the next model takes over the rest of the same ladder, so the total pause is the same.
const PRIMARY_NOT_FOUND_RETRIES = 3;

let cachedClient: OpenAI | undefined;

// The SDK does not read MODEL_API_KEY on its own, so it is passed explicitly. Read at call time
// so a missing key fails the request, not the module load (and the build).
export function getClient(): OpenAI {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.MODEL_API_KEY;
  if (!apiKey) throw new Error("MODEL_API_KEY is not set");
  cachedClient = new OpenAI({
    apiKey,
    baseURL: process.env.MODEL_BASE_URL ?? DEFAULT_BASE_URL,
    timeout: 90_000,
  });
  return cachedClient;
}

// Tests inject a scripted client here; pass undefined to go back to the real one.
export function setModelClient(client: OpenAI | undefined): void {
  cachedClient = client;
}

export function modelId(): string {
  return process.env.MODEL_ID ?? DEFAULT_MODEL;
}

// The model ids to fall back on, in order, when the configured one answers 404 "model not found" through its share of
// the retry ladder (MODEL_FALLBACK_IDS, comma separated; set it to an empty string for no fallback).
export const DEFAULT_FALLBACK_IDS = "muse-spark-1.2";

export function fallbackModelIds(): string[] {
  const raw = process.env.MODEL_FALLBACK_IDS ?? DEFAULT_FALLBACK_IDS;
  const primary = modelId();
  return [...new Set(raw.split(",").map((id) => id.trim()).filter((id) => id !== "" && id !== primary))];
}

// What a turn may call, in order: the configured model, then the fallbacks.
export function modelCandidates(): string[] {
  return [modelId(), ...fallbackModelIds()];
}

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

// What a handler may know about the model call that asked for it.
// What a handler is told about the model call that asked for it. `toolCalls` are the calls this turn has already
// finished, in order, summarized for the proof (never shown to the model).
export type ToolMeta = {
  responseId: string;
  model: string;
  call: ModelCallTrace;
  toolCalls: ToolCallSummary[];
  // This call's own id, and the ids of the calls this turn has already finished (with their tool names). A tool can
  // hand its id back to the model so a later call can cite it as the source of a number.
  callId: string;
  finishedCalls: Array<{ callId: string; name: string }>;
};

// Receives the parsed JSON arguments, or the raw string when the model sent invalid JSON.
// Handlers zod-parse their own input; whatever they return (or throw) goes back to the model.
export type ToolHandler = (args: unknown, meta?: ToolMeta) => Promise<unknown>;

export type TurnFailure = {
  // model_error: the model API failed or answered incomplete (a 404 or a 5xx is not a cap). no_tool_call: it answered in
  // prose after the nudge. cap_reached: it used up the turn's tool calls, the only real cap here.
  reason: "model_error" | "no_tool_call" | "cap_reached";
  // The same thing at finer grain: too many tool calls, no tool call after the nudge, or the model API failed.
  detail: "tool_cap" | "no_tool_call" | "api_error";
  message?: string;
};

export type ModelCallTrace = {
  responseId: string;
  // The model that answered. When it is a fallback, `fallbackFrom` is the configured model that did not (404).
  model: string;
  fallbackFrom?: string;
  ms: number;
  chained: boolean;
  chainRetries: number;
  toolNames: string[];
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
};

export type ToolCallTrace = {
  name: string;
  callId: string;
  ok: boolean;
  // First 200 characters of the error a failed call returned to the model.
  error?: string;
};

export type TurnResult = {
  status: "completed" | "failed";
  failure?: TurnFailure;
  finalText: string;
  nudged: boolean;
  toolCalls: ToolCallTrace[];
  calls: ModelCallTrace[];
  totalMs: number;
  // Set by the runtime when the model could not produce a message and the scripted fallback sent one instead.
  fallback?: boolean;
};

// How a turn carries context between its model calls.
// - "stateless" (default): store false, encrypted reasoning replayed by hand. Meta's recommended mode.
//   Measured on 2026-10-24: a follow-up call takes 0.6 to 1.0 s.
// - "chain": previous_response_id. Measured the same day at 9.9 to 10.5 s per follow-up call, a fixed
//   server-side cost, so it is the fallback only. Select with MODEL_CHAIN_MODE=chain.
export type ContextMode = "stateless" | "chain";

export function contextMode(): ContextMode {
  return process.env.MODEL_CHAIN_MODE === "chain" ? "chain" : "stateless";
}

type Effort = "minimal" | "low" | "medium" | "high";

// "low" unless MODEL_EFFORT says otherwise (minimal, low, medium, high).
function defaultEffort(): Effort {
  const configured = process.env.MODEL_EFFORT;
  return configured === "minimal" || configured === "medium" || configured === "high" ? configured : "low";
}

export type AgentTurnOptions = {
  instructions: string;
  // The thread history and the new message, as the user turn. A friend agent's words go here,
  // never into `instructions`, to limit cross-agent prompt injection.
  input: string | ResponseInput;
  tools: ToolDefinition[];
  handlers: Record<string, ToolHandler>;
  // The turn is only done once one of these succeeded (for example send_to_friend_agent). A reply
  // with no tool call before that gets one nudge, then the turn fails. Omit when prose is fine.
  requiredTools?: string[];
  // How many successful calls to required tools finish the turn (default 1). A coordinator that has to
  // answer two friends in one turn needs 2.
  requiredSuccesses?: number;
  // End the turn as soon as a required tool succeeded, skipping the closing prose call. Default true.
  finishOnRequired?: boolean;
  nudge?: string;
  // How a finished tool call is summarized for the proof on the message it leads to. The default keeps content out.
  summarizeCall?: (call: { name: string; args: unknown; output: unknown; ok: boolean }) => ToolCallSummary;
  maxToolCalls?: number;
  effort?: Effort;
  maxOutputTokens?: number;
  mode?: ContextMode;
};

function toFunctionTool(tool: ToolDefinition): FunctionTool {
  // `strict` stays false: optional fields cannot satisfy strict mode, and zod is the enforcement.
  return { type: "function", name: tool.name, description: tool.description, parameters: tool.parameters, strict: false };
}

function statusOf(error: unknown): number | undefined {
  return error instanceof OpenAI.APIError ? error.status : undefined;
}

// MODEL_RETRY_SCALE shrinks every retry pause (tests set it to 0); unset it is 1.
function sleep(ms: number): Promise<void> {
  const scale = Number(process.env.MODEL_RETRY_SCALE ?? 1);
  return new Promise((resolve) => setTimeout(resolve, ms * (Number.isFinite(scale) && scale >= 0 ? scale : 1)));
}

function isModelNotFound(error: unknown): boolean {
  return error instanceof OpenAI.APIError && error.status === 404 && (error.code === "model_not_found" || /requested model was not found/i.test(error.message));
}

// Which model a turn is calling. Starts on the configured one; once a fallback has answered the rest of the turn stays
// on it, so the reasoning items it replays come from one model and a down model is not retried on every call.
type ModelRoute = { models: string[]; index: number };

type Created = { response: Response; chainRetries: number; model: string; fallbackFrom?: string };

// A just-finished response can briefly answer a chain call with 400 or 404; retry after a pause. A 404
// model_not_found is retried on any call, chained or not, because the model is there on the next try. If it keeps
// answering 404, the call moves to the next model in the route (immediately, and only for this error: a 429 or a 5xx
// never switches models) and that model uses the rest of the ladder.
async function createResponse(params: Omit<ResponseCreateParamsNonStreaming, "model">, route: ModelRoute): Promise<Created> {
  const client = getClient();
  let chainRetries = 0;
  let notFoundRetries = 0;
  let retriesOnThisModel = 0;
  for (;;) {
    const model = route.models[route.index];
    try {
      const response = await client.responses.create({ ...params, model });
      return { response, chainRetries, model, fallbackFrom: route.index > 0 ? route.models[0] : undefined };
    } catch (error) {
      if (isModelNotFound(error)) {
        const hasNext = route.index < route.models.length - 1;
        if (hasNext && retriesOnThisModel >= PRIMARY_NOT_FOUND_RETRIES) {
          if (process.env.NODE_ENV !== "test") console.warn(`model ${model} answered 404 model_not_found; trying ${route.models[route.index + 1]}`);
          route.index += 1;
          retriesOnThisModel = 0;
          continue;
        }
        if (notFoundRetries < MODEL_NOT_FOUND_RETRY_DELAYS_MS.length) {
          await sleep(MODEL_NOT_FOUND_RETRY_DELAYS_MS[notFoundRetries]);
          notFoundRetries += 1;
          retriesOnThisModel += 1;
          continue;
        }
        throw error;
      }
      const status = statusOf(error);
      const retriable = params.previous_response_id && (status === 400 || status === 404);
      if (!retriable || chainRetries >= CHAIN_RETRY_DELAYS_MS.length) throw error;
      await sleep(CHAIN_RETRY_DELAYS_MS[chainRetries]);
      chainRetries += 1;
    }
  }
}

// Stateless replay can be rejected when a reasoning item is malformed; drop reasoning items and retry once.
function withoutReasoning(items: ResponseInput): ResponseInput {
  return items.filter((item) => !("type" in item && item.type === "reasoning"));
}

function replayable(item: Response["output"][number]): InputItem {
  // Reasoning items must be replayed with an empty summary and their encrypted content.
  if (item.type === "reasoning") return { ...item, summary: item.summary ?? [] } as InputItem;
  return item as InputItem;
}

function parseArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const DEFAULT_NUDGE =
  "You have not acted yet. Call one of your tools now to carry out your next step. Do not reply with prose only.";

// One agent turn as one previous_response_id chain: instructions, tools, and effort resent on every
// call, function_call_output returned per call_id, at most six tool calls, temperature unset.
export async function runAgentTurn(options: AgentTurnOptions): Promise<TurnResult> {
  const started = Date.now();
  const cap = options.maxToolCalls ?? MAX_TOOL_CALLS_PER_TURN;
  const required = new Set(options.requiredTools ?? []);
  const tools = options.tools.map(toFunctionTool);
  const calls: ModelCallTrace[] = [];
  const toolCalls: ToolCallTrace[] = [];
  // The same calls as one-line summaries for the message proof; kept beside the traces, never sent to the model.
  const performed: ToolCallSummary[] = [];
  const finished: Array<{ callId: string; name: string }> = [];

  const route: ModelRoute = { models: modelCandidates(), index: 0 };
  const mode = options.mode ?? contextMode();
  const initial: ResponseInput =
    typeof options.input === "string" ? [{ role: "user", content: options.input }] : [...options.input];
  // Stateless mode resends the whole history; chain mode sends only `pending` plus previous_response_id.
  const history: ResponseInput = [...initial];
  let pending: ResponseInput = initial;
  let previousResponseId: string | undefined;
  const needed = options.requiredSuccesses ?? 1;
  let successes = 0;
  let requiredSatisfied = required.size === 0;
  let nudged = false;
  let finalText = "";

  const finish = (status: "completed" | "failed", failure?: TurnFailure): TurnResult => ({
    status,
    failure,
    finalText,
    nudged,
    toolCalls,
    calls,
    totalMs: Date.now() - started,
  });

  for (;;) {
    const callStarted = Date.now();
    let response: Response;
    let chainRetries: number;
    let answeredBy: Pick<Created, "model" | "fallbackFrom">;
    const shared = {
      instructions: options.instructions,
      tools,
      reasoning: { effort: options.effort ?? defaultEffort() },
      max_output_tokens: options.maxOutputTokens ?? 4096,
    } satisfies Partial<ResponseCreateParamsNonStreaming>;
    try {
      if (mode === "chain") {
        ({ response, chainRetries, ...answeredBy } = await createResponse({ ...shared, input: pending, previous_response_id: previousResponseId }, route));
      } else {
        const stateless = { ...shared, store: false, include: ["reasoning.encrypted_content" as const] };
        try {
          ({ response, chainRetries, ...answeredBy } = await createResponse({ ...stateless, input: history }, route));
        } catch (error) {
          if (statusOf(error) !== 400 || !history.some((item) => "type" in item && item.type === "reasoning")) throw error;
          ({ response, chainRetries, ...answeredBy } = await createResponse({ ...stateless, input: withoutReasoning(history) }, route));
        }
      }
    } catch (error) {
      return finish("failed", { reason: "model_error", detail: "api_error", message: describeError(error) });
    }

    const functionCalls = response.output.filter((item) => item.type === "function_call");
    const trace: ModelCallTrace = {
      responseId: response.id,
      model: response.model ?? answeredBy.model,
      ...(answeredBy.fallbackFrom ? { fallbackFrom: answeredBy.fallbackFrom } : {}),
      ms: Date.now() - callStarted,
      chained: mode === "chain" && previousResponseId !== undefined,
      chainRetries,
      toolNames: functionCalls.map((call) => call.name),
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens ?? 0,
      cachedTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
    };
    calls.push(trace);
    finalText = response.output_text ?? "";

    if (response.status !== "completed") {
      return finish("failed", {
        reason: "model_error",
        detail: "api_error",
        message: response.incomplete_details?.reason ?? response.status ?? "incomplete",
      });
    }

    if (functionCalls.length === 0) {
      if (requiredSatisfied) return finish("completed");
      if (nudged) return finish("failed", { reason: "no_tool_call", detail: "no_tool_call" });
      nudged = true;
      history.push(...response.output.map(replayable));
      pending = [{ role: "user", content: options.nudge ?? DEFAULT_NUDGE }];
      history.push(...pending);
      previousResponseId = response.id;
      continue;
    }

    if (toolCalls.length + functionCalls.length > cap) {
      return finish(requiredSatisfied ? "completed" : "failed", requiredSatisfied ? undefined : { reason: "cap_reached", detail: "tool_cap" });
    }

    history.push(...response.output.map(replayable));
    const outputs: ResponseInput = [];
    for (const call of functionCalls) {
      const handler = options.handlers[call.name];
      const args = parseArguments(call.arguments);
      let output: unknown;
      let ok = true;
      if (!handler) {
        output = { error: `unknown tool ${call.name}` };
        ok = false;
      } else {
        try {
          output = await handler(args, { responseId: trace.responseId, model: trace.model, call: trace, toolCalls: [...performed], callId: call.call_id, finishedCalls: [...finished] });
          if (typeof output === "object" && output !== null && "error" in output) ok = false;
        } catch (error) {
          output = { error: describeError(error) };
          ok = false;
        }
      }
      toolCalls.push({
        name: call.name,
        callId: call.call_id,
        ok,
        error: ok ? undefined : JSON.stringify(output).slice(0, 200),
      });
      performed.push((options.summarizeCall ?? summarizeToolCall)({ name: call.name, args, output, ok }));
      finished.push({ callId: call.call_id, name: call.name });
      if (ok && required.has(call.name)) {
        successes += 1;
        if (successes >= needed) requiredSatisfied = true;
      }
      outputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(output) });
    }

    if (requiredSatisfied && required.size > 0 && options.finishOnRequired !== false) return finish("completed");

    history.push(...outputs);
    pending = outputs;
    previousResponseId = response.id;
  }
}
