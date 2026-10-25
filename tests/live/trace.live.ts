import { it } from "vitest";
import { z } from "zod";
import { runAgentTurn } from "@/lib/model";
import { SendToFriendArgs } from "@/lib/protocol";
import { CALENDAR_RANGE, PERSONAS } from "@/lib/seed/fixtures";
import { freeBlocks } from "@/lib/agent/windows";

// Diagnostic: where does a two-call turn spend its time? Prints one JSON line per run.
const free = freeBlocks(PERSONAS.aaron.calendar, CALENDAR_RANGE).filter((block) => block.start >= "2026-10-26");
const sendParameters = z.toJSONSchema(SendToFriendArgs, { target: "draft-07" }) as Record<string, unknown>;
delete sendParameters.$schema;

it("traces a calendar-then-send turn", async () => {
  for (let run = 0; run < 3; run += 1) {
    const result = await runAgentTurn({
      instructions:
        "You are Sprout, a Muse agent for one person. Check the calendar with get_my_calendar before offering windows, then open the conversation with send_to_friend_agent. Windows must come from the calendar result.",
      input: "Lisa sent your human a reel about Shawarma Point on E 6th St (open until 9pm). Open a conversation with Lisa's agent: send an intent that names the place and offers up to 2 windows next week.",
      tools: [
        { name: "get_my_calendar", description: "Free blocks for my human between two ISO times.", parameters: { type: "object", properties: { start: { type: "string" }, end: { type: "string" } }, required: ["start", "end"], additionalProperties: false } },
        { name: "send_to_friend_agent", description: "Send one structured message to your friend's agent.", parameters: sendParameters },
      ],
      handlers: {
        get_my_calendar: async () => ({ free }),
        send_to_friend_agent: async (args) => {
          const parsed = SendToFriendArgs.safeParse(args);
          return parsed.success ? { ok: true } : { error: z.prettifyError(parsed.error) };
        },
      },
      requiredTools: ["send_to_friend_agent"],
      effort: (process.env.TRACE_EFFORT as "minimal" | "low" | undefined) ?? "low",
    });
    console.log("TRACE", JSON.stringify({ status: result.status, totalMs: result.totalMs, calls: result.calls }));
  }
}, 300_000);
