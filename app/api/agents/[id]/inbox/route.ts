import { after } from "next/server";
import { AgentId } from "@/lib/protocol";
import { runInboxTurn } from "@/lib/agent/runtime";
import { authenticateSender, httpDeliver, receiveMessage } from "@/lib/agent/wire";
import { getStore } from "@/lib/store";

// One agent hop is one request: validate, persist, answer 202, then run the receiving agent's turn
// after responding, so a chain of agent-to-agent calls never waits on a model call.
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const recipient = AgentId.safeParse((await params).id);
  if (!recipient.success) return Response.json({ error: "unknown agent" }, { status: 404 });

  const sender = authenticateSender(request.headers.get("authorization"));
  if (!sender) return Response.json({ error: "missing or invalid bearer token" }, { status: 401, headers: { "www-authenticate": "Bearer" } });
  if (sender === recipient.data) return Response.json({ error: "an agent cannot message itself" }, { status: 403 });

  let envelope: unknown;
  try {
    envelope = await request.json();
  } catch {
    return Response.json({ error: "body must be JSON" }, { status: 400 });
  }

  const store = await getStore();
  const result = await receiveMessage(store, { recipient: recipient.data, sender, envelope });
  if (!result.ok) return Response.json({ error: result.error }, { status: result.status });

  // Answer 202 now. The timeline rows and ledger finish after the response, then the receiving agent's turn.
  const origin = new URL(request.url).origin;
  after(async () => {
    try {
      await result.finish();
      if (result.runTurn) {
        await runInboxTurn({ store, agent: recipient.data, contextId: result.body.contextId, deliver: httpDeliver(origin, recipient.data) });
      }
    } catch (error) {
      console.error("inbox follow-up failed", error);
    }
  });

  // A2A-shaped acknowledgement: the task id is the thread, the state is the task state.
  return Response.json({ id: result.body.contextId, contextId: result.body.contextId, seq: result.body.seq, status: { state: result.body.state } }, { status: 202 });
}
