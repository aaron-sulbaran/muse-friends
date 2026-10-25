import { toCentralIso, toMs } from "@/lib/agent/windows";
import type { ActivityEvent, Plan, PlanHistoryEntry, PlanState, StateSnapshot } from "@/lib/protocol";
import { DEMO_START, deadReelSignal, privacyToggleDemo, recordedSnapshot, seedSnapshot } from "@/lib/seed/fixtures";
import type { Decision, Role } from "./types";

/*
 * Plays Lane A's recorded shawarma run one stage at a time, so the UI can be
 * clicked through before the live agents drive the store. The thread, plan,
 * policies, and timeline events are Lane A's fixture; this file only decides how
 * much of it is visible and scripts the stages after awaiting_humans (the humans'
 * answers, the handoff, the clock jumps) that the plan lifecycle will own once
 * lib/plans.ts lands. Delete it when the UI reads the real store.
 */

export const THREAD_LENGTH = 6;

export type ScriptState = {
  reelLoaded: boolean;
  /** How many of the recorded thread's six messages have arrived. */
  messagesShown: number;
  decisions: Record<Role, Decision>;
  /** True once a human took the draft to WhatsApp (opened it or copied it). */
  handoff: boolean;
  /** 0 is the start; 1 jumps to the Tuesday reminder; 2 jumps to the next day. */
  clockStage: 0 | 1 | 2;
  locationShared: boolean;
  simulatedFriend: boolean;
  mode: "live" | "replay";
};

export type ScriptAction =
  | { type: "load_reel" }
  | { type: "next_message" }
  | { type: "decide"; role: Role; choice: "accept" | "decline" }
  | { type: "handoff" }
  | { type: "clock_next" }
  | { type: "set_location"; shared: boolean }
  | { type: "set_simulated"; value: boolean }
  | { type: "set_mode"; mode: "live" | "replay" }
  | { type: "reset" };

export function initialScriptState(): ScriptState {
  return {
    reelLoaded: false,
    messagesShown: 0,
    decisions: { a: "pending", b: "pending" },
    handoff: false,
    clockStage: 0,
    locationShared: true,
    simulatedFriend: false,
    mode: "live",
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

export function reduceScript(state: ScriptState, action: ScriptAction): ScriptState {
  switch (action.type) {
    case "load_reel":
      return { ...state, reelLoaded: true };
    case "next_message":
      if (!state.reelLoaded) return { ...state, reelLoaded: true };
      return state.messagesShown >= THREAD_LENGTH ? state : { ...state, messagesShown: state.messagesShown + 1 };
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
    case "set_location":
      return { ...state, locationShared: action.shared };
    case "set_simulated":
      return { ...state, simulatedFriend: action.value };
    case "set_mode":
      return { ...state, mode: action.mode };
    case "reset":
      return initialScriptState();
  }
}

const atSeconds = (seconds: number) => toCentralIso(toMs(DEMO_START) + seconds * 1000);
const REMINDER_AT = "2026-10-27T17:00:00-05:00";
const HAPPENED_AT = "2026-10-27T20:00:00-05:00";
const FOLLOW_UP_AT = "2026-10-28T10:00:00-05:00";

function historyFor(state: ScriptState, recorded: PlanHistoryEntry[], planState: PlanState): PlanHistoryEntry[] {
  const history: PlanHistoryEntry[] = [recorded[0]];
  if (state.messagesShown >= 1) history.push(recorded[1]);
  if (state.messagesShown >= THREAD_LENGTH) history.push(recorded[2]);
  const reached = (...states: PlanState[]) => states.includes(planState);
  if (reached("confirmed", "scheduled", "reminded", "followed_up")) history.push({ state: "confirmed", at: atSeconds(45) });
  if (reached("scheduled", "reminded", "followed_up")) history.push({ state: "scheduled", at: atSeconds(50) });
  if (reached("reminded", "followed_up")) history.push({ state: "reminded", at: REMINDER_AT });
  if (reached("followed_up")) {
    history.push({ state: "happened", at: HAPPENED_AT });
    history.push({ state: "followed_up", at: FOLLOW_UP_AT });
  }
  if (reached("dropped")) history.push({ state: "dropped", at: atSeconds(45) });
  return history;
}

function humanEvents(state: ScriptState): ActivityEvent[] {
  const planBase = { contextId: recordedSnapshot().threads[0].contextId, planId: recordedSnapshot().plans[0].id };
  const events: ActivityEvent[] = [];
  const named: Record<Role, "aaron" | "lisa"> = { a: "aaron", b: "lisa" };
  const label: Record<Role, string> = { a: "Aaron", b: state.simulatedFriend ? "Michelle" : "Lisa" };
  for (const role of ["a", "b"] as const) {
    if (state.decisions[role] === "accepted") {
      events.push({
        id: `evt_decision_${role}`,
        at: atSeconds(role === "a" ? 41 : 43),
        kind: "human_decision",
        actor: "human",
        agent: named[role],
        text: `${label[role]} said yes`,
        ...planBase,
      });
    }
  }
  if (state.handoff) {
    events.push({ id: "evt_handoff", at: atSeconds(48), kind: "handoff_opened", actor: "human", agent: "aaron", text: "Aaron took the draft to WhatsApp", ...planBase });
  }
  if (state.clockStage >= 1) {
    events.push({ id: "evt_clock_1", at: REMINDER_AT, kind: "clock_advanced", actor: "system", text: "Clock moved to Tuesday 5:00 PM", ...planBase });
  }
  if (state.clockStage >= 2) {
    events.push({ id: "evt_showed_up", at: HAPPENED_AT, kind: "plan_state", actor: "human", text: "Showed up (simulated clock)", ...planBase });
    events.push({ id: "evt_clock_2", at: FOLLOW_UP_AT, kind: "clock_advanced", actor: "system", text: "Clock moved to Wednesday 10:00 AM", ...planBase });
  }
  return events;
}

/** The store snapshot for one stage of the script, shaped exactly like what the real store returns. */
export function buildStateSnapshot(state: ScriptState): StateSnapshot {
  const planState = derivePlanState(state);
  if (planState === null) {
    const seed = seedSnapshot();
    seed.signals = [deadReelSignal()];
    return seed;
  }

  const recorded = recordedSnapshot();
  const shown = Math.min(state.messagesShown, THREAD_LENGTH);
  const records = recorded.messages.slice(0, shown);
  if (!state.locationShared && records[1]) {
    const withheld = privacyToggleDemo().messageAfter;
    records[1] = { ...withheld, message: { ...withheld.message, at: records[1].message.at } };
  }

  const lastAt = records.at(-1)?.message.at ?? atSeconds(4);
  const recordedPlan = recorded.plans[0];
  const bothAnswered = planState !== "detected" && planState !== "negotiating";
  const activity = recordedPlan.activity && !state.locationShared ? { kind: recordedPlan.activity.kind, title: recordedPlan.activity.title } : recordedPlan.activity;
  const plan: Plan = {
    ...recordedPlan,
    state: planState,
    activity,
    window: shown >= THREAD_LENGTH ? recordedPlan.window : undefined,
    decisions: { aaron: state.decisions.a, lisa: state.decisions.b },
    draft: ["confirmed", "scheduled", "reminded", "followed_up"].includes(planState) ? recordedPlan.draft : undefined,
    dropReason: planState === "dropped" ? "declined" : undefined,
    history: historyFor(state, recordedPlan.history, planState),
    updatedAt: lastAt,
  };

  const visibleUntil = toMs(bothAnswered ? atSeconds(38) : lastAt);
  const events = [...recorded.events.filter((event) => toMs(event.at) <= visibleUntil), ...humanEvents(state)];
  const clockNow = state.clockStage === 2 ? FOLLOW_UP_AT : state.clockStage === 1 ? REMINDER_AT : bothAnswered ? atSeconds(38) : lastAt;

  const thread = recorded.threads[0];
  return {
    ...recorded,
    clock: { now: clockNow },
    signals: [recorded.signals[0], deadReelSignal()],
    threads: shown > 0 ? [{ ...thread, messageCount: shown, state: shown >= THREAD_LENGTH ? "input-required" : "working", updatedAt: lastAt }] : [],
    messages: records,
    plans: [plan],
    cards: bothAnswered ? recorded.cards : [],
    events,
  };
}
