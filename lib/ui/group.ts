import { z } from "zod";
import { runAgentTurn } from "@/lib/model";
import type { Plan } from "@/lib/protocol";
import type { TripPlayers } from "@/lib/agent/trip";
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

// ---------------------------------------------------------------------------
// The trip: the same two people, answering the trip's own questions
// ---------------------------------------------------------------------------

const money = (amount: number) => `$${amount.toLocaleString("en-US")}`;

const QuestionAnswer = z.strictObject({ answer: z.enum(["yes", "no", "limit"]), limit: z.number().int().min(100).max(20_000).optional() });
const JoinAnswer = z.strictObject({ choice: z.enum(["in", "out"]) });

/** Who a model is told it is for the trip's questions: the person's own taste and honest ceiling, never the others'. */
export function tripPersonInstructions(member: SimulatedMember): string {
  const person = TRIP_PEOPLE[member];
  const limit = person.constraint ? ` and you have ${person.constraint}` : "";
  return (
    `You are ${person.name}, a fictional friend in a demo of Muse Friends. You like ${person.taste}${limit}. ` +
    `For a trip like this your honest ceiling is ${money(person.ceiling)} per person. Your Muse, ${person.muse}, asks you one question on behalf of the group; answer as ${person.name} would, truthfully about your ceiling.`
  );
}

/** One real model call per question. Throws when the model does not answer, so a caller never fakes a person's answer. */
export async function memberAnswersQuestion(member: SimulatedMember, range: { low: number; high: number }): Promise<{ answer: "yes" | "no" | "limit"; limit?: number }> {
  let picked: z.infer<typeof QuestionAnswer> | null = null;
  const result = await runAgentTurn({
    instructions: tripPersonInstructions(member),
    input: `Is ${money(range.low)} to ${money(range.high)} per person okay for the whole trip? Flights, stay and activities. Answer yes if the top of that range is fine for you, no if you would rather stay at the bottom of it, or give your own limit.`,
    tools: [
      {
        name: "answer_question",
        description: "Answer the bounded question: yes, no, or your own limit in whole dollars.",
        parameters: {
          type: "object",
          properties: { answer: { type: "string", enum: ["yes", "no", "limit"] }, limit: { type: "integer", description: "Your limit in whole dollars; only with answer limit" } },
          required: ["answer"],
          additionalProperties: false,
        },
      },
    ],
    handlers: {
      answer_question: async (args) => {
        const parsed = QuestionAnswer.safeParse(args);
        if (!parsed.success) throw new Error("answer must be yes, no, or limit with a whole dollar limit");
        if (parsed.data.answer === "limit" && parsed.data.limit === undefined) throw new Error("say your limit in whole dollars");
        picked = parsed.data;
        return { recorded: true };
      },
    },
    requiredTools: ["answer_question"],
    maxToolCalls: 2,
  });
  if (result.status !== "completed" || picked === null) throw new Error(result.failure?.message ?? `${TRIP_PEOPLE[member].name} did not answer`);
  return picked;
}

/** One real model call: does the person join the trip and put their deposit in the pot? */
export async function memberJoins(member: SimulatedMember, summary: string): Promise<{ choice: "in" | "out" }> {
  let choice: "in" | "out" | null = null;
  const result = await runAgentTurn({
    instructions: tripPersonInstructions(member),
    input: summary,
    tools: [
      {
        name: "join_trip",
        description: "Say in to join the trip and put the deposit in the pot, or out to pass.",
        parameters: { type: "object", properties: { choice: { type: "string", enum: ["in", "out"] } }, required: ["choice"], additionalProperties: false },
      },
    ],
    handlers: {
      join_trip: async (args) => {
        const parsed = JoinAnswer.safeParse(args);
        if (!parsed.success) throw new Error("choice must be in or out");
        choice = parsed.data.choice;
        return { recorded: true };
      },
    },
    requiredTools: ["join_trip"],
    maxToolCalls: 2,
  });
  if (result.status !== "completed" || choice === null) throw new Error(result.failure?.message ?? `${TRIP_PEOPLE[member].name} did not answer`);
  return { choice };
}

/** The players the app runs with: a real model plays each simulated person. */
export const modelPlayers: TripPlayers = { answers: memberAnswersQuestion, joins: memberJoins };
