import { runAgentTurn, type ToolHandler } from "@/lib/model";
import { CHAT_KEPT, CHAT_QUESTION_MAX, ChatEntry, type ActivityEvent, type AgentId, type ModelProof } from "@/lib/protocol";
import { displayName } from "@/lib/seed/fixtures";
import type { Store } from "@/lib/store";
import { summarizeToolCall } from "@/lib/tool-summary";
import { buildChatTools, CHAT_TOOL_NAMES } from "./chat-tools";
import { chatInstructions, chatTurnInput } from "./chat-prompts";
import { newId } from "./ids";
import { withLock } from "./lock";
import { toCentralIso } from "./windows";

/*
 * The chat with a person's own Muse (D31): one model turn over the read tools in chat-tools.ts, no required tool
 * (prose is the answer). The turn can read, and nothing else: it has no tool that sends a message to the friend's
 * Muse, moves money, decides a plan or changes a setting, so those stay with the plan flow and the confirm.
 *
 * What it leaves behind: the question and the answer on the room (Room.chat, the last CHAT_KEPT lines), and one
 * Activity row, "You asked: ...", whose messageId is the answer's id, so a screen can pair the row with the answer and
 * its proof (the model call and the tools it used). When the model is down nothing is stored and the caller gets a 503
 * with the honest reason: a chat answer is never faked.
 */

export type ChatOptions = { store: Store; agent?: AgentId; text: string; wallNow?: () => number };
export type ChatOutcome =
  | { ok: true; question: ChatEntry; answer: ChatEntry }
  | { ok: false; status: 400 | 503; error: string };

const unavailable = (agent: AgentId) => `${displayName(agent)}'s Muse could not answer just now: the model is not responding. Your question was not sent; try again in a moment.`;

const nowMs = (options: ChatOptions) => options.wallNow?.() ?? Date.now();

// Wraps each handler so the turn's tool calls can be summarized for the proof (one line each, no content).
function recording(handlers: Record<string, ToolHandler>, summaries: ReturnType<typeof summarizeToolCall>[]): Record<string, ToolHandler> {
  return Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [
      name,
      (async (args, meta) => {
        try {
          const output = await handler(args, meta);
          const failed = typeof output === "object" && output !== null && typeof (output as { error?: unknown }).error === "string";
          summaries.push(summarizeToolCall({ name, args, output, ok: !failed }));
          return output;
        } catch (error) {
          summaries.push(summarizeToolCall({ name, args, output: { error: error instanceof Error ? error.message : "failed" }, ok: false }));
          throw error;
        }
      }) satisfies ToolHandler,
    ]),
  );
}

export async function runChatTurn(options: ChatOptions): Promise<ChatOutcome> {
  const { store } = options;
  const agent = options.agent ?? "aaron";
  const text = options.text.replace(/\s+/g, " ").trim();
  if (text === "") return { ok: false, status: 400, error: "Write a question for your Muse first." };
  if (text.length > CHAT_QUESTION_MAX) return { ok: false, status: 400, error: `Keep it under ${CHAT_QUESTION_MAX} characters.` };

  const summaries: ReturnType<typeof summarizeToolCall>[] = [];
  const { tools, handlers } = buildChatTools({ store, agent, wallNow: options.wallNow }, CHAT_TOOL_NAMES);
  const earlier = (await store.getRoom()).chat ?? [];
  const clock = await store.getClock();
  const result = await runAgentTurn({
    instructions: chatInstructions(agent),
    input: chatTurnInput({ agent, text, earlier, nowIso: clock.now }),
    tools,
    handlers: recording(handlers, summaries),
    // Prose is the answer. More than a handful of lookups for one question is a loop, so the cap stays low.
    maxToolCalls: 5,
  });

  const answerText = result.finalText.trim();
  if (result.status === "failed" || answerText === "") {
    const at = toCentralIso(nowMs(options));
    await store.appendEvent({
      id: newId("evt", nowMs(options)),
      at,
      kind: "turn_failed",
      actor: "agent",
      agent,
      text: `${displayName(agent)}'s Muse could not answer a chat question (${result.status === "failed" ? "model error" : "empty answer"}). Nothing was stored.`,
    });
    return { ok: false, status: 503, error: unavailable(agent) };
  }

  const last = result.calls.at(-1);
  const proof: ModelProof = {
    model: last?.model ?? "",
    responseId: last?.responseId ?? "",
    latencyMs: result.totalMs,
    inputTokens: result.calls.reduce((sum, call) => sum + call.inputTokens, 0),
    outputTokens: result.calls.reduce((sum, call) => sum + call.outputTokens, 0),
    reasoningTokens: result.calls.reduce((sum, call) => sum + call.reasoningTokens, 0),
    ...(summaries.length > 0 ? { toolCalls: summaries.slice(-10) } : {}),
  };
  const at = toCentralIso(nowMs(options));
  const question = ChatEntry.parse({ id: newId("chat", nowMs(options)), from: "user", text, at });
  const answer = ChatEntry.parse({ id: newId("chat", nowMs(options) + 1), from: "muse", text: answerText.slice(0, 1500), at: toCentralIso(nowMs(options) + 1), replyTo: question.id, proof });

  await withLock("room-chat", async () => {
    const room = await store.getRoom();
    await store.putRoom({ ...room, chat: [...(room.chat ?? []), question, answer].slice(-CHAT_KEPT) });
  });
  const plan = (await store.listPlans()).filter((candidate) => candidate.participants.includes(agent)).at(-1);
  const row: ActivityEvent = {
    id: newId("evt", nowMs(options)),
    at,
    kind: "chat_asked",
    actor: "human",
    agent,
    ...(plan ? { planId: plan.id, contextId: plan.contextId } : {}),
    messageId: answer.id,
    text: `You asked: ${text.length > 200 ? `${text.slice(0, 199)}…` : text}`,
  };
  await store.appendEvent(row);
  return { ok: true, question, answer };
}
