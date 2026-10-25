import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getClient, modelId, runAgentTurn, type ContextMode, type TurnResult } from "@/lib/model";
import { SendToFriendArgs } from "@/lib/protocol";
import { CALENDAR_RANGE, PERSONAS } from "@/lib/seed/fixtures";
import { freeBlocks } from "@/lib/agent/windows";

// TECH_SPEC smoke tests 1 to 3 against live Muse Spark. Numbers are printed as one JSON line per test.

function summarize(label: string, values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { label, n: values.length, minMs: sorted[0], medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted.at(-1), meanMs: Math.round(mean) };
}

function report(name: string, data: unknown) {
  console.log(`SMOKE ${name} ${JSON.stringify(data)}`);
}

const aaronFree = freeBlocks(PERSONAS.aaron.calendar, CALENDAR_RANGE).filter((block) => block.start >= "2026-10-26");

describe("smoke 1: billing and latency", () => {
  it("answers a ping through the SDK with effort low", async () => {
    const times: number[] = [];
    for (let run = 0; run < 3; run += 1) {
      const started = Date.now();
      const response = await getClient().responses.create({
        model: modelId(),
        input: "ping",
        reasoning: { effort: "low" },
      });
      times.push(Date.now() - started);
      expect(response.status).toBe("completed");
      expect(response.output_text.length).toBeGreaterThan(0);
    }
    report("1-ping", summarize("ping", times));
  });
});

const calendarTool = {
  name: "get_my_calendar",
  description: "Return the free blocks on my human's calendar between two ISO times.",
  parameters: {
    type: "object",
    properties: {
      start: { type: "string", description: "ISO 8601 start, for example 2026-10-26T00:00:00-05:00" },
      end: { type: "string", description: "ISO 8601 end" },
    },
    required: ["start", "end"],
    additionalProperties: false,
  },
};

describe("smoke 2: tool loop", () => {
  // "chain" is the TECH_SPEC mechanism (previous_response_id); "stateless" is the default in lib/model.ts.
  const modes: Array<{ mode: ContextMode; runs: number }> = [
    { mode: "stateless", runs: 5 },
    { mode: "chain", runs: 3 },
  ];

  for (const { mode, runs } of modes) {
    it(`calls get_my_calendar, takes the output, and answers in text on the second call (${mode})`, async () => {
      const totals: number[] = [];
      const secondCall: number[] = [];
      let chainRetries = 0;
      for (let run = 0; run < runs; run += 1) {
        let args: unknown;
        const result = await runAgentTurn({
          mode,
          instructions: "You are Sprout, a Muse agent. Use tools for facts. Be brief.",
          input: "Is my human free on Tuesday October 27 2026 between 6pm and 8pm Central? Check the calendar first.",
          tools: [calendarTool],
          handlers: {
            get_my_calendar: async (received) => {
              args = received;
              return { free: aaronFree };
            },
          },
        });
        expect(result.status).toBe("completed");
        expect(result.toolCalls.map((call) => call.name)).toEqual(["get_my_calendar"]);
        expect(z.object({ start: z.string(), end: z.string() }).safeParse(args).success).toBe(true);
        expect(result.calls).toHaveLength(2);
        expect(result.finalText.length).toBeGreaterThan(0);
        totals.push(result.totalMs);
        secondCall.push(result.calls[1].ms);
        chainRetries += result.calls[1].chainRetries;
      }
      report(`2-tool-loop-${mode}`, { turn: summarize("turn", totals), secondCall: summarize("second", secondCall), chainRetries });
    });
  }
});

const reelNote =
  "Lisa sent your human a reel about Shawarma Point on E 6th St (open until 9pm). Your human is free: " +
  aaronFree.slice(0, 6).map((block) => `${block.start} to ${block.end}`).join("; ") +
  ". Open a conversation with Lisa's agent: send an intent that names the place and offers up to 3 of those windows.";

describe("smoke 3: the message as tool arguments", () => {
  it("calls send_to_friend_agent every time, with arguments zod accepts", async () => {
    const parameters = z.toJSONSchema(SendToFriendArgs, { target: "draft-07" }) as Record<string, unknown>;
    delete parameters.$schema;
    const tool = {
      name: "send_to_friend_agent",
      description: "Send one structured message to your friend's agent.",
      parameters,
    };

    const runs: Array<{ calls: number; firstTryOk: boolean; repaired: boolean; ms: number; nudged: boolean; status: TurnResult["status"] }> = [];
    const totals: number[] = [];
    for (let run = 0; run < 10; run += 1) {
      let attempts = 0;
      let failures = 0;
      let accepted = false;
      const result = await runAgentTurn({
        instructions:
          "You are Sprout, a Muse agent for one person. You coordinate plans with a friend's agent only through send_to_friend_agent. " +
          "Never invent availability: windows must be copied from the free blocks you were given. Keep the note under 140 characters.",
        input: reelNote,
        tools: [tool],
        handlers: {
          send_to_friend_agent: async (args) => {
            attempts += 1;
            const parsed = SendToFriendArgs.safeParse(args);
            if (parsed.success) {
              accepted = true;
              return { ok: true, seq: 1 };
            }
            failures += 1;
            return { error: z.prettifyError(parsed.error) };
          },
        },
        requiredTools: ["send_to_friend_agent"],
      });
      runs.push({ calls: attempts, firstTryOk: accepted && failures === 0, repaired: accepted && failures > 0, ms: result.totalMs, nudged: result.nudged, status: result.status });
      totals.push(result.totalMs);
    }
    report("3-send-tool", {
      turn: summarize("turn", totals),
      firstTryOk: runs.filter((run) => run.firstTryOk).length,
      repaired: runs.filter((run) => run.repaired).length,
      failed: runs.filter((run) => run.status === "failed").length,
      nudged: runs.filter((run) => run.nudged).length,
    });
    expect(runs.every((run) => run.firstTryOk || run.repaired)).toBe(true);
  });

  it("probe: text.format together with a function tool (the design must not depend on it)", async () => {
    try {
      const response = await getClient().responses.create({
        model: modelId(),
        instructions: "You are Sprout. Reply as JSON.",
        input: "Say hello and call get_my_calendar for Oct 27.",
        tools: [{ type: "function", strict: false, ...calendarTool }],
        text: { format: { type: "json_schema", name: "greeting", schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } } },
        reasoning: { effort: "low" },
      });
      report("3-probe-text-format-with-tools", { status: response.status, outputTypes: response.output.map((item) => item.type) });
    } catch (error) {
      report("3-probe-text-format-with-tools", { error: error instanceof Error ? error.message.slice(0, 300) : String(error) });
    }
  });
});
