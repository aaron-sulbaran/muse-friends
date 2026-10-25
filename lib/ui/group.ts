import { z } from "zod";
import { runAgentTurn } from "@/lib/model";
import type { Plan } from "@/lib/protocol";
import { TRIP_PEOPLE, type SimulatedMember } from "@/lib/seed/trip";
import { friendCard } from "./friend";

/*
 * The people of a plan for three whom a model plays when one judge plays alone. Michelle (Mochi's seat) has her own
 * path in ./friend.ts; Kai (Pebble's person, who has no phone) is played here the same way: shown the card the
 * coordinator's phone would show them, one real model call, and the lifecycle records the answer like a tap. The
 * agents are unchanged and the UI says "played by a model".
 */

const Answer = z.strictObject({ choice: z.enum(["accept", "decline"]) });

/** What the model is told it is. Only the person's own profile and the card: never the other members' calendars. */
export function memberInstructions(member: SimulatedMember): string {
  const person = TRIP_PEOPLE[member];
  const likes = person.constraint ? `You like ${person.taste}, and you have ${person.constraint}.` : `You like ${person.taste}.`;
  return (
    `You are ${person.name}, a fictional friend in a demo of Muse Friends. ${likes} Your Muse, ${person.muse}, agreed a plan with ` +
    "two friends' Muses and now shows you one card. Decide the way a friendly person would: say accept unless the card is empty or makes no sense. " +
    "Answer only by calling answer_card."
  );
}

export type MemberAnswer = { choice: "accept" | "decline"; responseId: string | null };

/** One real model call. Throws when the model does not answer, so a caller never fakes a person's decision. */
export async function memberDecides(member: SimulatedMember, plan: Plan): Promise<MemberAnswer> {
  let choice: MemberAnswer["choice"] | null = null;
  const result = await runAgentTurn({
    instructions: memberInstructions(member),
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
    throw new Error(result.failure?.message ?? `${TRIP_PEOPLE[member].name} did not answer`);
  }
  return { choice, responseId: result.calls.at(-1)?.responseId ?? null };
}
