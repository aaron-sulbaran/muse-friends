import OpenAI from "openai";
import { setModelClient } from "@/lib/model";

// A scripted stand-in for the Meta Model API: each create() call takes the next step.
// A hosted web search the "API" ran before answering: a preface message, the search item with its hits, then the answer.
export type FakeSearch = { query: string; results: Array<{ title: string; url: string }>; preface?: string };

export type Step =
  | { search: FakeSearch; text: string }
  | { calls: Array<{ name: string; args: unknown }>; text?: string; reasoning?: boolean }
  | { text: string }
  | { error: number; code?: string; requestId?: string };

export type RecordedCall = Record<string, unknown> & { input: unknown };

export function installFakeModel(steps: Step[]) {
  const calls: RecordedCall[] = [];
  let index = 0;
  let responseCounter = 0;

  const create = async (params: RecordedCall) => {
    calls.push(structuredClone(params));
    const step = steps[index];
    index += 1;
    if (!step) throw new Error("fake model ran out of steps");
    if ("error" in step) {
      const body = step.code ? { message: "The requested model was not found.", code: step.code } : { message: "scripted" };
      throw OpenAI.APIError.generate(step.error, body, body.message, new Headers(step.requestId ? { "x-request-id": step.requestId } : {}));
    }

    responseCounter += 1;
    const id = `resp_${responseCounter}`;
    const output: unknown[] = [];
    if ("search" in step) {
      const preface = step.search.preface ?? "I'll look that up.";
      output.push({ type: "reasoning", id: `rs_${responseCounter}`, summary: [], encrypted_content: "enc" });
      output.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: preface }] });
      output.push({
        type: "web_search_call",
        id: `ws_${responseCounter}`,
        status: "completed",
        action: { type: "search", query: step.search.query },
        results: step.search.results.map((hit) => ({ type: "text_result", title: hit.title, url: hit.url, snippet: "" })),
      });
      output.push({ type: "message", role: "assistant", content: [{ type: "output_text", text: step.text }] });
      // The SDK's output_text glues every message together; the loop must not use it for the answer.
      return { id, status: "completed", output, output_text: `${preface}${step.text}`, usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 2 } } };
    }
    if ("calls" in step && step.reasoning !== false) {
      output.push({ type: "reasoning", id: `rs_${responseCounter}`, summary: [], encrypted_content: "enc" });
    }
    if ("calls" in step) {
      step.calls.forEach((call, position) =>
        output.push({
          type: "function_call",
          id: `fc_${responseCounter}_${position}`,
          call_id: `call_${responseCounter}_${position}`,
          name: call.name,
          arguments: typeof call.args === "string" ? call.args : JSON.stringify(call.args),
          status: "completed",
        }),
      );
    }
    const text = "text" in step ? (step.text ?? "") : "";
    if (text) output.push({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
    return {
      id,
      status: "completed",
      output,
      output_text: text,
      usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 2 } },
    };
  };

  setModelClient({ responses: { create } } as unknown as OpenAI);
  return { calls, remaining: () => steps.length - index };
}

export function removeFakeModel() {
  setModelClient(undefined);
}
