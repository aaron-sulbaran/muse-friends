import { runAgentTurn, type TurnResult } from "@/lib/model";
import { type ActivityEvent, type AgentId, type MemberId, type Plan, type PlanGroup, type Signal } from "@/lib/protocol";
import { displayName } from "@/lib/seed/fixtures";
import type { Store } from "@/lib/store";
import type { AgentRuntimeContext } from "./context";
import { failThread } from "./inbound";
import { newId } from "./ids";
import { ownFreeBlocks } from "./calendar";
import { claimCoordinatorTurn, groupCandidates, groupReplies, memberContexts, planForContext } from "./group";
import { agentInstructions, groupOpeningInput, groupTurnInput, inboxTurnInput, signalTurnInput } from "./prompts";
import { buildTools } from "./tools";
import { describeWindow, intersectWindows, toCentralIso, windowHash } from "./windows";

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
  await Promise.all([store.putSignal({ ...signal, receivedAt: at }), store.putPlan(plan), store.appendEvent(event)]);
  return { contextId, planId };
}

// The timeline says a turn failed and why in a word; the full reason (an API error body, an incomplete
// response) goes to the server log, where the person running the demo can read it.
function logFailure(agent: AgentId, result: TurnResult): void {
  if (process.env.NODE_ENV !== "test") console.error(`agent turn failed (${agent})`, result.failure);
}

// The initiator's turn: read the reel, extract the place from the caption, check the calendar,
// and open the conversation. A turn that cannot produce a message ends the thread as failed.
export async function runSignalTurn(options: RuntimeOptions & { agent: AgentId; signalId: string; contextId: string; group?: PlanGroup }): Promise<TurnResult> {
  const { store, agent, signalId, contextId, group } = options;
  // For a group the coordinator opens one pair thread per friend, in the same turn.
  const friends = group ? group.members.filter((member) => member !== group.coordinator) : undefined;
  const ctx: AgentRuntimeContext = {
    agent,
    store,
    wallNow: options.wallNow,
    signalId,
    contextId,
    deliver: options.deliver,
    windowRepairs: { used: 0 },
    ...(group && friends ? { group, counterparts: friends, contexts: group.contexts } : {}),
  };
  const { tools, handlers } = buildTools(ctx);
  const nowMs = options.wallNow?.() ?? Date.now();
  const result = await runAgentTurn({
    instructions: agentInstructions(agent, friends),
    input: friends ? groupOpeningInput(agent, signalId, nowMs, friends) : signalTurnInput(agent, signalId, nowMs),
    tools,
    handlers,
    requiredTools: ["send_to_friend_agent"],
    requiredSuccesses: friends?.length ?? 1,
  });
  if (result.status === "failed") {
    logFailure(agent, result);
    await failThread(store, contextId, agent, result.failure?.detail ?? "turn failed", options.wallNow?.());
  }
  return result;
}

// The receiving agent's turn after a message lands in its inbox: read the thread, see which of the
// friend's windows are also free (computed here), and answer through send_to_friend_agent. In a group plan
// a member answers its pair thread with the windows that are free for it, and the coordinator's turn is the
// group turn below.
export async function runInboxTurn(options: RuntimeOptions & { agent: MemberId; contextId: string }): Promise<TurnResult> {
  const { store, agent, contextId } = options;
  // A thread that ended (agreed, declined, or hit the cap) gets no further turn and no model call.
  const current = await store.getThread(contextId);
  if (current && current.state !== "working") return { status: "completed", finalText: "", nudged: false, toolCalls: [], calls: [], totalMs: 0 };

  const plan = current?.groupId ? await planForContext(store, contextId) : null;
  if (plan?.group && agent === plan.group.coordinator) return runGroupTurn({ ...options, plan });

  const thread = (await store.listMessages(contextId)).map((record) => record.message);
  const friendLast = [...thread].reverse().find((message) => message.from !== agent);
  const friend = friendLast?.from ?? (agent === "aaron" ? "lisa" : "aaron");
  const nowMs = options.wallNow?.() ?? Date.now();

  const ledger = new Set(await store.listRejectedWindows(contextId));
  const allOffered = thread.flatMap((message) => message.windows ?? []);
  const passedOver = allOffered.filter((window) => ledger.has(windowHash(window))).map((window) => `${describeWindowForLedger(window)}`);
  const ownFree = await ownFreeBlocks(store, agent);
  const mutualWindows = intersectWindows(friendLast?.windows ?? [], ownFree).filter((window) => !ledger.has(windowHash(window)));

  const ctx: AgentRuntimeContext = {
    agent,
    store,
    wallNow: options.wallNow,
    contextId,
    deliver: options.deliver,
    windowRepairs: { used: 0 },
    counterparts: [friend],
    ...(plan?.group ? { group: plan.group } : {}),
  };
  const { tools, handlers } = buildTools(ctx);
  const result = await runAgentTurn({
    instructions: agentInstructions(agent, [friend]),
    input: inboxTurnInput({ agent, thread, mutualWindows, passedOver, nowMs, friend, group: plan?.group ? { coordinator: plan.group.coordinator } : undefined }),
    tools: tools.filter((tool) => ["get_my_calendar", "get_interests", "send_to_friend_agent"].includes(tool.name)),
    handlers,
    requiredTools: ["send_to_friend_agent"],
  });
  if (result.status === "failed") {
    logFailure(agent, result);
    await failThread(store, contextId, agent, result.failure?.detail ?? "turn failed", options.wallNow?.());
  }
  return result;
}

// The coordinator's second round, once every friend has answered. The windows that work for everyone were
// worked out in code; the model confirms one with each friend (two sends), or ends it if there is none.
// A failed turn ends every pair thread of the group as failed, so the plan is dropped with the reason on the timeline.
export async function runGroupTurn(options: RuntimeOptions & { agent: MemberId; contextId: string; plan: Plan }): Promise<TurnResult> {
  const { store, agent, plan } = options;
  const group = plan.group!;
  const nowMs = options.wallNow?.() ?? Date.now();
  const [candidates, replies] = await Promise.all([groupCandidates(store, plan), groupReplies(store, plan)]);
  const friends = memberContexts(group).map(({ member }) => member);
  const ctx: AgentRuntimeContext = {
    agent,
    store,
    wallNow: options.wallNow,
    contextId: options.contextId,
    deliver: options.deliver,
    windowRepairs: { used: 0 },
    group,
    counterparts: friends,
    contexts: group.contexts,
  };
  const { tools, handlers } = buildTools(ctx);
  const result = await runAgentTurn({
    instructions: agentInstructions(agent, friends),
    input: groupTurnInput({ coordinator: agent, replies, candidates, nowMs }),
    tools: tools.filter((tool) => ["get_my_calendar", "get_interests", "send_to_friend_agent"].includes(tool.name)),
    handlers,
    requiredTools: ["send_to_friend_agent"],
    requiredSuccesses: friends.length,
  });
  if (result.status === "failed") {
    for (const { contextId } of memberContexts(group)) await failThread(store, contextId, agent, result.failure?.detail ?? "turn failed", options.wallNow?.());
  }
  return result;
}

function describeWindowForLedger(window: { start: string; end: string }): string {
  return `${describeWindow(window)} [${window.start} to ${window.end}]`;
}
