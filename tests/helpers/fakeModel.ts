import OpenAI from "openai";
import { setModelClient } from "@/lib/model";

// A scripted stand-in for the Meta Model API: each create() call takes the next step.
export type Step =
  | { calls: Array<{ name: string; args: unknown }>; text?: string; reasoning?: boolean }
  | { text: string }
  | { error: number; code?: string };

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
      throw OpenAI.APIError.generate(step.error, body, body.message, new Headers());
    }

    responseCounter += 1;
    const id = `resp_${responseCounter}`;
    const output: unknown[] = [];
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
