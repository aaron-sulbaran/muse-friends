import { CATEGORIES, isCategoryAllowed, type ActivityEvent, type Plan, type StateSnapshot } from "@/lib/protocol";
import type { Decision, FollowThroughEvent, UiMessage, UiPlan, UiSnapshot } from "./types";

/*
 * The one place the Store's StateSnapshot becomes what the UI renders. When the
 * contract changes (roles instead of agent ids, proof fields on messages), this
 * is the file that changes.
 */

export type UiOverlay = {
  mode: "live" | "replay";
  /** True when phone B is played by the model instead of a second human. */
  simulatedFriend: boolean;
};

/** Human events that are not follow-through: reading a reel and changing a setting are not showing up. */
const notFollowThrough = new Set<ActivityEvent["kind"]>(["signal_received", "policy_changed", "clock_advanced"]);

function latestPlan(plans: Plan[]): Plan | null {
  return plans.at(-1) ?? null;
}

function toUiPlan(plan: Plan): UiPlan {
  return {
    id: plan.id,
    contextId: plan.contextId,
    initiator: plan.initiator,
    state: plan.state,
    activityTitle: plan.activity?.title ?? "the plan",
    place: plan.activity?.place ?? null,
    window: plan.window ?? null,
    decisions: {
      a: (plan.decisions.aaron ?? "pending") as Decision,
      b: (plan.decisions.lisa ?? "pending") as Decision,
    },
    draft: plan.draft ?? null,
    droppedReason: plan.state === "dropped" ? dropReasonText(plan.dropReason) : null,
    history: plan.history.map(({ state, at }) => ({ state, at })),
  };
}

function dropReasonText(reason: Plan["dropReason"]): string {
  switch (reason) {
    case "cap_reached":
      return "No agreement in 6 messages";
    case "declined":
      return "A person said not now";
    case "no_overlap":
      return "No shared free time";
    case "policy_blocked":
      return "Privacy policy blocked the message";
    case "failed":
      return "A model call failed";
    default:
      return "The plan ended";
  }
}

function toUiMessages(state: StateSnapshot): UiMessage[] {
  return state.messages.map((record) => {
    const { message } = record;
    const rejected = record.delivery !== "delivered";
    return {
      id: message.id,
      contextId: message.contextId,
      seq: message.seq,
      from: message.from,
      to: message.to,
      type: message.type,
      state: message.state,
      activity: message.activity ? { title: message.activity.title, place: message.activity.place } : undefined,
      windows: message.windows,
      reason: message.reason,
      note: message.note,
      shared: record.stamp.passed,
      removed: record.stamp.removed,
      at: message.at,
      blockedRule: rejected ? (record.error ?? "Rejected by the receiving inbox") : undefined,
      raw: message,
    };
  });
}

/** Whose model call is running right now, derived from the thread: the receiver of the last message, or the initiator before the first. */
function deriveInFlight(state: StateSnapshot, plan: Plan | null): UiSnapshot["inFlight"] {
  if (!plan) return null;
  const thread = state.threads.find((candidate) => candidate.contextId === plan.contextId);
  if (!thread) return plan.state === "detected" ? { agent: plan.initiator } : null;
  if (thread.state !== "working") return null;
  const last = state.messages.filter((record) => record.message.contextId === thread.contextId).at(-1);
  return { agent: last ? last.message.to : thread.initiator };
}

function toFollowThrough(events: ActivityEvent[]): FollowThroughEvent[] {
  return events
    .filter((event) => event.actor === "human" && !notFollowThrough.has(event.kind))
    .map((event) => ({ id: event.id, label: event.text, at: event.at }));
}

export function toUiSnapshot(state: StateSnapshot, overlay: UiOverlay): UiSnapshot {
  const plan = latestPlan(state.plans);
  const lisaPolicy = state.policies.find((policy) => policy.owner === "lisa" && policy.friend === "aaron");
  const categories = Object.fromEntries(CATEGORIES.map((category) => [category, isCategoryAllowed(lisaPolicy, category)])) as Record<
    (typeof CATEGORIES)[number],
    boolean
  >;
  const messages = toUiMessages(state);
  return {
    now: state.clock.now,
    clockSimulated: state.events.some((event) => event.kind === "clock_advanced"),
    mode: overlay.mode,
    simulatedFriend: overlay.simulatedFriend,
    messages,
    plan: plan ? toUiPlan(plan) : null,
    followThrough: { events: toFollowThrough(state.events), agentMessageCount: messages.length },
    inFlight: deriveInFlight(state, plan),
    lisaSharesWithAaron: { tier: lisaPolicy?.tier ?? "off", categories },
  };
}
