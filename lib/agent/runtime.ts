import { runAgentTurn, type TurnResult } from "@/lib/model";
import { type ActivityEvent, type AgentId, type MemberId, type Plan, type PlanGroup, type Signal, isPaymentType } from "@/lib/protocol";
import { displayName } from "@/lib/seed/fixtures";
import type { Store } from "@/lib/store";
import type { AgentRuntimeContext } from "./context";
import { startGate } from "@/lib/policy";
import { fallbackFollowUp, fallbackGroupConfirm, fallbackGroupOpening, fallbackOpening, fallbackReply, type FallbackOutcome } from "./fallback";
import { failThread } from "./inbound";
import { runPaymentTurn } from "./payment-runtime";
import { newId, seatOf } from "./ids";
import { ownFreeBlocks } from "./calendar";
import { groupCandidates, groupReplies, memberContexts, planForContext } from "./group";
import { agentInstructions, followUpTurnInput, groupOpeningInput, groupTurnInput, inboxTurnInput, signalTurnInput } from "./prompts";
import type { Contact } from "@/lib/seed/contacts";
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
// response) goes to the server log, where the person running the demo can read it. The log says what happened in
// plain words: a model that did not answer is not a cap, and it says whether the scripted fallback spoke.
// The request ids of the failed API calls, for the log line only: the first and the last bracket a burst, and the count says how
// long it was. These are what the Meta reps look up. Never on the timeline row.
function describeRequestIds(ids: string[] | undefined): string {
  if (!ids || ids.length === 0) return "";
  return ids.length === 1 ? `; request id ${ids[0]}` : `; request ids ${ids[0]} to ${ids.at(-1)}, ${ids.length} calls`;
}

export function describeFailure(failure: TurnResult["failure"]): string {
  switch (failure?.reason) {
    case "model_error":
      return `the model did not answer (${failure.message ?? failure.detail}${describeRequestIds(failure.requestIds)})`;
    case "no_tool_call":
      return "the model replied without acting, even after a nudge";
    case "cap_reached":
      return "the model used up its tool calls for the turn";
    default:
      return "the turn did not finish";
  }
}

// The few words the timeline row carries (the long reason stays in the log): never the API's body, and never "cap"
// for a model that simply did not answer.
function failureWords(failure: TurnResult["failure"]): string {
  switch (failure?.reason) {
    case "model_error":
      return "the model did not answer";
    case "no_tool_call":
      return "the model replied without acting";
    case "cap_reached":
      return "the model used up its tool calls";
    default:
      return "turn failed";
  }
}

function logFailure(agent: MemberId, result: TurnResult, fallbackSpoke: boolean): void {
  if (process.env.NODE_ENV !== "test") console.error(`agent turn failed (${agent}): ${describeFailure(result.failure)}; ${fallbackSpoke ? "the scripted fallback spoke" : "no scripted fallback could speak"}`);
}

// A turn the model could not finish still gets an answer: the scripted fallback sends a message built in code.
// Only when that cannot send either does the thread end as failed, and the reason says why: no free time at
// all is no_overlap; anything else is that an agent could not reply.
// A group ends every one of its pair threads together, so the plan is dropped with the reason on the timeline.
async function recoverOrFail(
  options: RuntimeOptions & { agent: MemberId; contextId: string },
  result: TurnResult,
  fallback: () => Promise<FallbackOutcome>,
  contexts: string[] = [options.contextId],
): Promise<TurnResult> {
  const outcome = await fallback();
  logFailure(options.agent, result, outcome.sent);
  if (outcome.sent) return { ...result, status: "completed", fallback: true };
  const reason = outcome.reason === "no_windows" ? "no_overlap" : "agent_unavailable";
  for (const contextId of contexts) await failThread(options.store, contextId, options.agent, failureWords(result.failure), options.wallNow?.(), reason);
  return result;
}

// The initiator's turn: read the reel, extract the place from the caption, check the calendar,
// and open the conversation. A turn the model cannot finish falls back to a scripted opening.
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
    if (group) return recoverOrFail(options, result, () => fallbackGroupOpening(ctx, group), memberContexts(group).map(({ contextId }) => contextId));
    return recoverOrFail(options, result, () => fallbackOpening(ctx));
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
  // A payment arrived: the payments channel has its own turn and its own tools.
  const lastMessage = thread.at(-1);
  const seat = seatOf(agent);
  if (lastMessage && isPaymentType(lastMessage.type)) return seat ? runPaymentTurn({ store, agent: seat, contextId, wallNow: options.wallNow, deliver: options.deliver }) : { status: "completed", finalText: "", nudged: false, toolCalls: [], calls: [], totalMs: 0 };
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
    return recoverOrFail(options, result, () => fallbackReply(ctx, { thread, mutualWindows, ledger, group: plan?.group !== undefined }));
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
    return recoverOrFail(options, result, () => fallbackGroupConfirm(ctx, plan, candidates), memberContexts(group).map(({ contextId }) => contextId));
  }
  return result;
}

function describeWindowForLedger(window: { start: string; end: string }): string {
  return `${describeWindow(window)} [${window.start} to ${window.end}]`;
}

// The opening turn of a follow-up: the person's Muse reads who they asked about, checks the calendar,
// and opens the conversation with the contact's Muse. Same send checks, same share policy (acquaintance).
export async function runFollowUpTurn(options: RuntimeOptions & { agent: AgentId; contact: Contact; contextId: string }): Promise<TurnResult> {
  const { store, agent, contact, contextId } = options;
  // The same gate as the start path, so a direct call cannot get around it.
  if (!startGate(contact).ok) return { status: "completed", finalText: "", nudged: false, toolCalls: [], calls: [], totalMs: 0 };
  const ctx: AgentRuntimeContext = { agent, store, wallNow: options.wallNow, target: contact.id, contextId, deliver: options.deliver, windowRepairs: { used: 0 } };
  const { tools, handlers } = buildTools(ctx);
  const nowMs = options.wallNow?.() ?? Date.now();
  const result = await runAgentTurn({
    instructions: agentInstructions(agent),
    input: followUpTurnInput(agent, contact, nowMs),
    tools: tools.filter((tool) => ["get_my_calendar", "get_interests", "send_to_friend_agent"].includes(tool.name)),
    handlers,
    requiredTools: ["send_to_friend_agent"],
  });
  if (result.status === "failed") {
    // recoverOrFail logs the failure once it knows whether the scripted fallback spoke.
    return recoverOrFail(options, result, () => fallbackFollowUp(ctx, contact));
  }
  return result;
}
