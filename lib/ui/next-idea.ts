import { z } from "zod";
import { runAgentTurn } from "@/lib/model";
import { OTHER_SIGNALS } from "@/lib/seed/past-signals";

/*
 * Server-only: after the shawarma plan happened, Muse picks the next idea from what the two people
 * already shared. One real Muse Spark call; any error, timeout or missing key falls back to the rule
 * (the most recently shared other signal), so the demo never stalls.
 */

export type NextIdea = { signalId: string; chosenBy: "model" | "rule" };
export type NextIdeaChooser = () => Promise<NextIdea>;

const TIMEOUT_MS = 8000;
const ids = OTHER_SIGNALS.map((signal) => signal.id);
const Pick = z.strictObject({ signalId: z.string(), why: z.string().max(120).optional() });

export function ruleChoice(): NextIdea {
  const latest = [...OTHER_SIGNALS].sort((a, b) => a.daysAgo - b.daysAgo)[0];
  return { signalId: latest.id, chosenBy: "rule" };
}

const instructions =
  "You are Sprout, a Muse. The shawarma plan between your person and their friend just happened. " +
  "Pick which of the other things the two of them shared would make the best next plan. Answer only by calling pick_next_idea.";

async function askModel(): Promise<NextIdea> {
  let picked: string | null = null;
  const list = OTHER_SIGNALS.map((s) => `- ${s.id}: ${s.title} (${s.kind}, shared ${s.daysAgo} days ago)`).join("\n");
  const result = await runAgentTurn({
    instructions,
    input: `Other things they shared:\n${list}`,
    tools: [
      {
        name: "pick_next_idea",
        description: "Choose the next idea.",
        parameters: {
          type: "object",
          properties: { signalId: { type: "string", enum: ids }, why: { type: "string", maxLength: 120 } },
          required: ["signalId", "why"],
          additionalProperties: false,
        },
      },
    ],
    handlers: {
      pick_next_idea: async (args) => {
        const parsed = Pick.safeParse(args);
        if (!parsed.success || !ids.includes(parsed.data.signalId)) throw new Error("signalId must be one of the listed ids");
        picked = parsed.data.signalId;
        return { recorded: true };
      },
    },
    requiredTools: ["pick_next_idea"],
    maxToolCalls: 2,
  });
  if (result.status !== "completed" || picked === null) throw new Error("no pick");
  return { signalId: picked, chosenBy: "model" };
}

export async function chooseNextIdea(): Promise<NextIdea> {
  if (!process.env.MODEL_API_KEY) return ruleChoice();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS);
    });
    return await Promise.race([askModel(), timeout]);
  } catch {
    return ruleChoice();
  } finally {
    if (timer) clearTimeout(timer);
  }
}
