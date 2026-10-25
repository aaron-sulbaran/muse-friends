import { toCentralIso, toMs } from "@/lib/agent/windows";
import {
  categoriesInMessage,
  isCategoryAllowed,
  SHARED_CATEGORIES,
  type ActivityEvent,
  type Category,
  type MessageRecord,
  type PlanState,
  type Redaction,
  type SharePolicy,
  type StateSnapshot,
} from "@/lib/protocol";
import { DEFAULT_POLICIES, DEMO_START, SHAWARMA_CONTEXT_ID, SHAWARMA_PLAN_ID, deadReelSignal, recordedSnapshot, seedSnapshot } from "@/lib/seed/fixtures";
import { displayName } from "@/lib/seed/personas";
import { snapshotAtPlanState } from "@/lib/seed/states";
import type { Decision, Role, ShareTier } from "./types";

/*
 * Plays Lane A's recorded shawarma run one stage at a time, so the UI can be
 * clicked through before the live agents drive the store. The thread and every
 * plan state are Lane A's fixtures (recordedSnapshot, snapshotAtPlanState); this
 * file only decides which stage is showing, tracks the humans' answers, and
 * replays the propose when a sharing switch changes. Delete it when the UI reads
 * the real store.
 */

export const THREAD_LENGTH = 6;

const defaultPolicy: SharePolicy = DEFAULT_POLICIES.find((policy) => policy.owner === "lisa")!;

export type ScriptState = {
  reelLoaded: boolean;
  /** How many of the recorded thread's six messages have arrived. */
  messagesShown: number;
  decisions: Record<Role, Decision>;
  /** True once a human took the draft to WhatsApp (opened it or copied it). */
  handoff: boolean;
  /** 0 is the start; 1 jumps to the reminder; 2 jumps to the next day. */
  clockStage: 0 | 1 | 2;
  /** What side b currently lets side a see. */
  policy: SharePolicy;
  /** The policy in force when the propose first arrived; each later change replays it. */
  proposeShownUnder: SharePolicy | null;
  replays: SharePolicy[];
  simulatedFriend: boolean;
  mode: "live" | "replay";
  resetCount: number;
};

export type ScriptAction =
  | { type: "load_reel" }
  | { type: "next_message" }
  | { type: "decide"; role: Role; choice: "accept" | "decline" }
  | { type: "handoff" }
  | { type: "clock_next" }
  | { type: "set_policy"; tier?: ShareTier; category?: Category; on?: boolean }
  | { type: "set_simulated"; value: boolean }
  | { type: "set_mode"; mode: "live" | "replay" }
  | { type: "reset" };

export function initialScriptState(resetCount = 0): ScriptState {
  return {
    reelLoaded: false,
    messagesShown: 0,
    decisions: { a: "pending", b: "pending" },
    handoff: false,
    clockStage: 0,
    policy: structuredClone(defaultPolicy),
    proposeShownUnder: null,
    replays: [],
    simulatedFriend: false,
    // This file plays a recording, so the label says so; the live store reports "live".
    mode: "replay",
    resetCount,
  };
}

export function derivePlanState(state: ScriptState): PlanState | null {
  if (!state.reelLoaded) return null;
  if (state.decisions.a === "declined" || state.decisions.b === "declined") return "dropped";
  if (state.messagesShown === 0) return "detected";
  if (state.messagesShown < THREAD_LENGTH) return "negotiating";
  const bothYes = state.decisions.a === "accepted" && state.decisions.b === "accepted";
  if (!bothYes) return "awaiting_humans";
  if (!state.handoff) return "confirmed";
  if (state.clockStage === 0) return "scheduled";
  if (state.clockStage === 1) return "reminded";
  return "followed_up";
}

function nextPolicy(current: SharePolicy, change: { tier?: ShareTier; category?: Category; on?: boolean }): SharePolicy {
  if (change.tier) return { ...current, tier: change.tier, categories: {} };
  if (change.category !== undefined && change.on !== undefined) {
    return { ...current, categories: { ...current.categories, [change.category]: change.on } };
  }
  return current;
}

export function reduceScript(state: ScriptState, action: ScriptAction): ScriptState {
  switch (action.type) {
    case "load_reel":
      return { ...state, reelLoaded: true };
    case "next_message": {
      if (!state.reelLoaded) return { ...state, reelLoaded: true };
      if (state.messagesShown >= THREAD_LENGTH) return state;
      const shown = state.messagesShown + 1;
      return { ...state, messagesShown: shown, proposeShownUnder: shown === 2 ? state.policy : state.proposeShownUnder };
    }
    case "decide": {
      if (derivePlanState(state) !== "awaiting_humans") return state;
      const decision: Decision = action.choice === "accept" ? "accepted" : "declined";
      return { ...state, decisions: { ...state.decisions, [action.role]: decision } };
    }
    case "handoff":
      return derivePlanState(state) === "confirmed" ? { ...state, handoff: true } : state;
    case "clock_next": {
      const plan = derivePlanState(state);
      if (state.clockStage === 0 && (plan === "scheduled" || plan === "confirmed")) return { ...state, handoff: true, clockStage: 1 };
      return state.clockStage === 1 ? { ...state, clockStage: 2 } : state;
    }
    case "set_policy": {
      const policy = nextPolicy(state.policy, action);
      const replays = derivePlanState(state) === "awaiting_humans" ? [...state.replays, policy] : state.replays;
      return { ...state, policy, replays };
    }
    case "set_simulated":
      return { ...state, simulatedFriend: action.value };
    case "set_mode":
      return { ...state, mode: action.mode };
    case "reset":
      return initialScriptState(state.resetCount + 1);
  }
}

const atSeconds = (seconds: number) => toCentralIso(toMs(DEMO_START) + seconds * 1000);

function humanEvent(id: string, kind: ActivityEvent["kind"], text: string, agent: "aaron" | "lisa", at: string): ActivityEvent {
  return { id, at, kind, actor: "human", agent, contextId: SHAWARMA_CONTEXT_ID, planId: SHAWARMA_PLAN_ID, text };
}

/** The recorded thread cut off after n messages: the middle of a negotiation. */
function negotiatingAfter(count: number): StateSnapshot {
  const full = recordedSnapshot();
  const messages = full.messages.slice(0, count);
  const lastAt = messages.at(-1)!.message.at;
  const clock = toCentralIso(toMs(lastAt) + 1000);
  return {
    ...full,
    clock: { now: clock },
    threads: [{ ...full.threads[0], state: "working", messageCount: count, updatedAt: lastAt }],
    messages,
    plans: [{ ...full.plans[0], state: "negotiating", window: undefined, draft: undefined, history: full.plans[0].history.slice(0, 2), updatedAt: lastAt }],
    cards: [],
    events: full.events.filter((event) => toMs(event.at) <= toMs(clock)),
  };
}

/** Both agents agreed; one person, both, or neither has answered. */
function awaitingWith(decisions: Record<Role, Decision>): StateSnapshot {
  const full = recordedSnapshot();
  const base = toMs(full.clock.now);
  const events = [...full.events];
  if (decisions.a === "accepted") events.push(humanEvent("evt_decision_a", "human_decision", `${snapshotName("aaron")} said yes to Shawarma Point`, "aaron", toCentralIso(base + 20_000)));
  if (decisions.b === "accepted") events.push(humanEvent("evt_decision_b", "human_decision", `${snapshotName("lisa")} said yes to Shawarma Point`, "lisa", toCentralIso(base + 25_000)));
  return {
    ...full,
    plans: [{ ...full.plans[0], decisions: { aaron: decisions.a, lisa: decisions.b } }],
    cards: full.cards.map((card) => ({ ...card, status: decisions[card.forAgent === "aaron" ? "a" : "b"] })),
    events,
  };
}

const snapshotName = displayName;

/** Lane A's dropped snapshot has side b passing; mirror it when side a is the one who said no. */
function droppedBy(decisions: Record<Role, Decision>): StateSnapshot {
  const dropped = snapshotAtPlanState("dropped");
  if (decisions.b === "declined") return dropped;
  return {
    ...dropped,
    plans: [{ ...dropped.plans[0], decisions: { aaron: "declined", lisa: "pending" }, history: dropped.plans[0].history.map((entry) => (entry.state === "dropped" ? { ...entry, note: `${snapshotName("aaron")} declined` } : entry)) }],
    cards: dropped.cards.map((card) => ({ ...card, status: card.forAgent === "aaron" ? "declined" : "pending" })),
    events: dropped.events.map((event) => (event.kind === "human_decision" ? { ...event, agent: "aaron", text: `${snapshotName("aaron")} passed on this one` } : event)),
  };
}

/** The propose as it would be delivered under a policy: disallowed categories removed, the stamp recomputed. */
export function projectPropose(record: MessageRecord, policy: SharePolicy): MessageRecord {
  const message = structuredClone(record.message);
  const removed: Category[] = [];
  for (const key of SHARED_CATEGORIES) {
    if (message.shared?.[key] && !isCategoryAllowed(policy, key)) {
      delete message.shared[key];
      removed.push(key);
    }
  }
  if (message.shared && Object.keys(message.shared).length === 0) delete message.shared;
  if (message.activity?.place && !isCategoryAllowed(policy, "location")) {
    delete message.activity.place;
    if (!removed.includes("location")) removed.push("location");
  }
  return { ...record, message, stamp: { passed: categoriesInMessage(message), removed, windowsDropped: 0 } };
}

function replayOf(original: MessageRecord, policy: SharePolicy, index: number): { record: MessageRecord; redaction: Redaction | null; events: ActivityEvent[] } {
  const at = atSeconds(70 + index * 10);
  const projected = projectPropose(original, policy);
  const record: MessageRecord = { ...projected, message: { ...projected.message, at } };
  const redaction: Redaction | null =
    record.stamp.removed.length > 0
      ? {
          id: `red_replay_${index}`,
          contextId: SHAWARMA_CONTEXT_ID,
          messageId: original.message.id,
          from: "lisa",
          to: "aaron",
          removed: record.stamp.removed,
          detail: `Sharing is off for ${record.stamp.removed.join(", ")}: removed before sending.`,
          at,
        }
      : null;
  const events: ActivityEvent[] = [
    humanEvent(`evt_policy_${index}`, "policy_changed", `${snapshotName("lisa")} changed what ${snapshotName("lisa")} shares with ${snapshotName("aaron")}`, "lisa", atSeconds(68 + index * 10)),
  ];
  if (redaction) {
    events.push({ id: `evt_redaction_${index}`, at, kind: "redaction", actor: "system", agent: "lisa", contextId: SHAWARMA_CONTEXT_ID, messageId: original.message.id, redactionId: redaction.id, text: `Policy removed ${record.stamp.removed.join(", ")} from ${snapshotName("lisa")}'s propose` });
  }
  return { record, redaction, events };
}

/** The store snapshot for one stage of the script, shaped exactly like what the real store returns. */
export function buildStateSnapshot(state: ScriptState): StateSnapshot {
  const planState = derivePlanState(state);
  const room = { id: "demo" as const, simulatedFriend: state.simulatedFriend, resetCount: state.resetCount, updatedAt: DEMO_START };
  const policies = (base: StateSnapshot) => base.policies.map((policy) => (policy.owner === "lisa" ? state.policy : policy));

  if (planState === null) {
    const seed = seedSnapshot();
    return { ...seed, signals: [deadReelSignal()], room, policies: policies(seed) };
  }

  let base: StateSnapshot;
  switch (planState) {
    case "detected":
      base = snapshotAtPlanState("detected");
      break;
    case "negotiating":
      base = negotiatingAfter(state.messagesShown);
      break;
    case "awaiting_humans":
      base = awaitingWith(state.decisions);
      break;
    case "dropped":
      base = droppedBy(state.decisions);
      break;
    default:
      base = snapshotAtPlanState(planState);
  }

  const messages = [...base.messages];
  const redactions = [...base.redactions];
  // Lane A's later snapshots include the handoff; until a person actually takes the draft away, it has not happened.
  const events = base.events.filter((event) => state.handoff || event.kind !== "handoff_opened");
  const original = messages[1];
  if (original) {
    messages[1] = projectPropose(original, state.proposeShownUnder ?? state.policy);
    state.replays.forEach((policy, index) => {
      const replay = replayOf(original, policy, index);
      messages.push(replay.record);
      if (replay.redaction) redactions.push(replay.redaction);
      events.push(...replay.events);
    });
  }

  const effective = state.replays.at(-1) ?? state.proposeShownUnder ?? state.policy;
  const plans = base.plans.map((plan) => {
    if (!plan.activity?.place || isCategoryAllowed(effective, "location")) return plan;
    const activity = { ...plan.activity };
    delete activity.place;
    return { ...plan, activity };
  });

  return { ...base, room, policies: policies(base), messages, redactions, events, plans };
}
