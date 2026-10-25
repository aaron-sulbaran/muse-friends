import { NextResponse } from "next/server";
import { z } from "zod";
import { refundChat, reserveChat } from "@/lib/agent/caps";
import { runChatTurn } from "@/lib/agent/chat";
import { CHAT_QUESTION_MAX } from "@/lib/protocol";
import { ROLE_TO_AGENT } from "@/lib/seed/fixtures";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.strictObject({
  /** Only side a has a chat with its Muse; the friend's side is scripted or played by the simulated friend. */
  role: z.enum(["a", "b"]).default("a"),
  text: z.string().trim().min(1).max(CHAT_QUESTION_MAX),
});

function refuse(message: string, status: number) {
  return NextResponse.json({ data: null, error: { message } }, { status });
}

/**
 * The person on side a asks their own Muse a question (D31). One model turn over read-only tools: the plan, the reel,
 * the wallet and payment history, the sharing settings, and the lines behind a payment. It cannot send a message to the
 * friend's Muse or move money. Takes a slot from the chat cap (20 an hour per room, and the app-wide hourly total) and
 * answers 200 with the question and the answer, 429 past the cap, or 503 with the honest reason when the model is down.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse(`Expected { text: 1 to ${CHAT_QUESTION_MAX} characters, role?: "a" }`, 400);
  if (parsed.data.role !== "a") return refuse("Only the first phone chats with its Muse; the friend's side has no chat.", 403);
  const store = await getStore();

  const reserved = reserveChat();
  if (!reserved.ok) {
    return NextResponse.json(
      { paused: true, reason: reserved.reason, text: reserved.text, budget: reserved.budget },
      { status: 429, headers: { "Retry-After": String(reserved.budget.retryAfterSeconds ?? 60) } },
    );
  }
  const outcome = await runChatTurn({ store, agent: ROLE_TO_AGENT[parsed.data.role], text: parsed.data.text });
  if (!outcome.ok) {
    refundChat();
    return refuse(outcome.error, outcome.status);
  }
  return NextResponse.json({ data: { question: outcome.question, answer: outcome.answer, budget: reserved.budget }, error: null });
}
