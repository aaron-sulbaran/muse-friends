import { CATEGORIES, isCategoryAllowed, type AgentId, type Plan, type SharePolicy, type StateSnapshot } from "@/lib/protocol";
import { displayName } from "@/lib/seed/personas";
import type { Decision, FollowThroughEvent, SharingSettings, UiMessage, UiPlan, UiSnapshot } from "./types";

/*
 * The one place the Store's StateSnapshot becomes what the UI renders. When the
 * contract changes, this is the file that changes. Server-only: it reads the
 * persona display names from the seed, and the seed's calendars (with private
 * event titles) must never reach a browser bundle.
 */

export type UiOverlay = {
  mode: "live" | "replay";
};

/** Taps and sends that move a plan along. Not the outcome, so never counted. */
const humanTapKinds = new Set(["human_decision", "handoff_opened"]);

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
  const seen = new Set<string>();
  return state.messages.map((record) => {
    const { message } = record;
    const rejected = record.delivery !== "delivered";
    const replayed = seen.has(message.id);
    seen.add(message.id);
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
      replayed,
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

function sharingFor(owner: AgentId, state: StateSnapshot): SharingSettings {
  const policy: SharePolicy | undefined = state.policies.find((candidate) => candidate.owner === owner);
  const categories = Object.fromEntries(CATEGORIES.map((category) => [category, isCategoryAllowed(policy, category)])) as Record<
    (typeof CATEGORIES)[number],
    boolean
  >;
  return { tier: policy?.tier ?? "off", categories };
}

/** The counter counts one thing: plans that happened. Lane A marks that moment with a followed_through event. */
function toFollowThrough(events: StateSnapshot["events"]): FollowThroughEvent[] {
  return events.filter((event) => event.kind === "followed_through").map((event) => ({ id: event.id, label: event.text, at: event.at }));
}

export function toUiSnapshot(state: StateSnapshot, overlay: UiOverlay): UiSnapshot {
  const plan = latestPlan(state.plans);
  const messages = toUiMessages(state);
  return {
    now: state.clock.now,
    clockSimulated: state.events.some((event) => event.kind === "clock_advanced"),
    mode: overlay.mode,
    simulatedFriend: state.room.simulatedFriend,
    sides: { aaron: displayName("aaron"), lisa: displayName("lisa") },
    messages,
    plan: plan ? toUiPlan(plan) : null,
    followThrough: {
      events: toFollowThrough(state.events),
      agentMessageCount: messages.length,
      humanTapCount: state.events.filter((event) => event.actor === "human" && humanTapKinds.has(event.kind)).length,
    },
    inFlight: deriveInFlight(state, plan),
    sharing: { aaron: sharingFor("aaron", state), lisa: sharingFor("lisa", state) },
  };
}
