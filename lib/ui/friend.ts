import { z } from "zod";
import { describeWindow } from "@/lib/agent/windows";
import { runAgentTurn } from "@/lib/model";
import type { Plan } from "@/lib/protocol";

/*
 * The simulated friend. When one judge plays alone, side b's person is Michelle,
 * fictional and played by a model: she is shown her card and answers it with one
 * real model call, the same way a judge would tap. The agents on both sides are
 * unchanged; only the human on side b is simulated, and the UI says so.
 */

const Answer = z.strictObject({ choice: z.enum(["accept", "decline"]) });

export const friendInstructions =
  "You are Michelle, a fictional friend in a demo of Muse Friends. Your Muse (a personal AI agent) agreed a plan with a friend's Muse " +
  "and now shows you one card. Decide the way a friendly person would: say accept unless the card is empty or makes no sense. " +
  "Answer only by calling answer_card.";

/** What Michelle sees on her card, built from the plan; never the other side's private data. */
export function friendCard(plan: Plan): string {
  const title = plan.activity?.title ?? "a plan";
  const when = plan.window ? describeWindow(plan.window) : "a time to be decided";
  return `Your Muse and your friend's Muse agreed on ${title}, ${when}. Do you want to go?`;
}

export type FriendAnswer = { choice: "accept" | "decline"; responseId: string | null };

/** One real model call. Throws when the model does not answer, so a caller never fakes Michelle's decision. */
export async function michelleDecides(plan: Plan): Promise<FriendAnswer> {
  let choice: FriendAnswer["choice"] | null = null;
  const result = await runAgentTurn({
    instructions: friendInstructions,
    input: friendCard(plan),
    tools: [
      {
        name: "answer_card",
        description: "Answer the card: accept to go, decline to pass.",
        parameters: { type: "object", properties: { choice: { type: "string", enum: ["accept", "decline"] } }, required: ["choice"], additionalProperties: false },
      },
    ],
    handlers: {
      answer_card: async (args) => {
        const parsed = Answer.safeParse(args);
        if (!parsed.success) throw new Error("choice must be accept or decline");
        choice = parsed.data.choice;
        return { recorded: true };
      },
    },
    requiredTools: ["answer_card"],
    maxToolCalls: 2,
  });
  if (result.status !== "completed" || choice === null) {
    throw new Error(result.failure?.message ?? "the simulated friend did not answer");
  }
  return { choice, responseId: result.calls.at(-1)?.responseId ?? null };
}
