import { runAgentTurn, type TurnResult } from "@/lib/model";
import { type ActivityEvent, type AgentId, type Plan, type Signal } from "@/lib/protocol";
import { displayName } from "@/lib/seed/fixtures";
import type { Store } from "@/lib/store";
import type { AgentRuntimeContext } from "./context";
import { failThread } from "./inbound";
import { newId } from "./ids";
import { agentInstructions, signalTurnInput } from "./prompts";
import { buildTools } from "./tools";
import { toCentralIso } from "./windows";

type RuntimeOptions = {
  store: Store;
  wallNow?: () => number;
  deliver?: AgentRuntimeContext["deliver"];
};

// Records a reel arriving: stores the signal, logs the human event, and opens a plan in "detected".
// The thread itself is created when the first message commits.
export async function injectSignal(store: Store, signal: Signal, wallNow: () => number = Date.now): Promise<{ contextId: string; planId: string }> {
  const now = wallNow();
  const at = toCentralIso(now);
  const contextId = newId("ctx", now);
  const planId = newId("plan", now);
  const plan: Plan = {
    id: planId,
    contextId,
    initiator: signal.to,
    participants: [signal.to, signal.from],
    state: "detected",
    decisions: { aaron: "pending", lisa: "pending" },
    history: [{ state: "detected", at, note: "Reel received" }],
    createdAt: at,
    updatedAt: at,
  };
  const event: ActivityEvent = {
    id: newId("evt", now),
    at,
    kind: "signal_received",
    actor: "human",
    agent: signal.from,
    contextId,
    planId,
    text: `${displayName(signal.from)} shared a reel with ${displayName(signal.to)}${signal.dmText ? `: "${signal.dmText}"` : ""}`,
  };
  await store.putSignal({ ...signal, receivedAt: at });
  await store.putPlan(plan);
  await store.appendEvent(event);
  return { contextId, planId };
}

// The initiator's turn: read the reel, extract the place from the caption, check the calendar,
// and open the conversation. A turn that cannot produce a message ends the thread as failed.
export async function runSignalTurn(options: RuntimeOptions & { agent: AgentId; signalId: string; contextId: string }): Promise<TurnResult> {
  const { store, agent, signalId, contextId } = options;
  const ctx: AgentRuntimeContext = {
    agent,
    store,
    wallNow: options.wallNow,
    signalId,
    contextId,
    deliver: options.deliver,
    windowRepairs: { used: 0 },
  };
  const { tools, handlers } = buildTools(ctx);
  const nowMs = options.wallNow?.() ?? Date.now();
  const result = await runAgentTurn({
    instructions: agentInstructions(agent),
    input: signalTurnInput(agent, signalId, nowMs),
    tools,
    handlers,
    requiredTools: ["send_to_friend_agent"],
  });
  if (result.status === "failed") {
    await failThread(store, contextId, agent, result.failure?.detail ?? "turn failed", options.wallNow?.());
  }
  return result;
}
