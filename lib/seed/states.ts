import { describeWindow, toCentralIso, toMs } from "@/lib/agent/windows";
import type { ActivityEvent, Plan, PlanState, Recommendation, StateSnapshot } from "@/lib/protocol";
import { DEMO_START, SHAWARMA_CONTEXT_ID, SHAWARMA_PLAN_ID, displayName, recordedSnapshot } from "./fixtures";

// One StateSnapshot per plan state, derived from the recorded shawarma thread, so every phone
// screen and timeline row can be rendered without a live agent. Scripted fixtures, not a live run.

const SPROUT = displayName("aaron");
const MOCHI = displayName("lisa");
const HOUR_MS = 3_600_000;

function wall(secondsAfterStart: number): string {
  return toCentralIso(toMs(DEMO_START) + secondsAfterStart * 1000);
}

function event(
  id: string,
  at: string,
  kind: ActivityEvent["kind"],
  actor: ActivityEvent["actor"],
  text: string,
  agent?: ActivityEvent["agent"],
): ActivityEvent {
  return { id, at, kind, actor, agent, contextId: SHAWARMA_CONTEXT_ID, planId: SHAWARMA_PLAN_ID, text };
}

function withStatus(cards: Recommendation[], statuses: Partial<Record<Recommendation["forAgent"], Recommendation["status"]>>) {
  return cards.map((card) => ({ ...card, status: statuses[card.forAgent] ?? card.status }));
}

function moveTo(plan: Plan, state: PlanState, at: string, note?: string): Plan {
  return { ...plan, state, updatedAt: at, history: [...plan.history, { state, at, note }] };
}

// The thread and plan as they stand just after the recorded run: both agents accepted.
function awaitingHumans(): StateSnapshot {
  return recordedSnapshot();
}

function detected(): StateSnapshot {
  const full = recordedSnapshot();
  const clock = wall(5);
  const plan: Plan = {
    ...full.plans[0],
    state: "detected",
    window: undefined,
    draft: undefined,
    history: full.plans[0].history.slice(0, 1),
    updatedAt: wall(4),
  };
  return {
    ...full,
    clock: { now: clock },
    threads: [],
    messages: [],
    plans: [plan],
    cards: [],
    events: full.events.filter((entry) => toMs(entry.at) <= toMs(clock)),
    rejectedWindows: {},
  };
}

function negotiating(): StateSnapshot {
  const full = recordedSnapshot();
  const clock = wall(21);
  const plan: Plan = {
    ...full.plans[0],
    state: "negotiating",
    window: undefined,
    draft: undefined,
    history: full.plans[0].history.slice(0, 2),
    updatedAt: wall(6),
  };
  return {
    ...full,
    clock: { now: clock },
    threads: [{ ...full.threads[0], state: "working", messageCount: 3, updatedAt: wall(20) }],
    messages: full.messages.slice(0, 3),
    plans: [plan],
    cards: [],
    events: full.events.filter((entry) => toMs(entry.at) <= toMs(clock)),
  };
}

function confirmed(): StateSnapshot {
  const full = recordedSnapshot();
  const base = toMs(full.clock.now);
  const at = (seconds: number) => toCentralIso(base + seconds * 1000);
  const plan = moveTo(
    { ...full.plans[0], decisions: { aaron: "accepted", lisa: "accepted" } },
    "confirmed",
    at(45),
    "Both people said yes",
  );
  return {
    ...full,
    clock: { now: at(45) },
    plans: [plan],
    cards: withStatus(full.cards, { aaron: "accepted", lisa: "accepted" }),
    events: [
      ...full.events,
      event("evt_decision_aaron", at(20), "human_decision", "human", `${SPROUT} said yes to Shawarma Point`, "aaron"),
      event("evt_handoff", at(25), "handoff_opened", "human", `${SPROUT} opened WhatsApp with the drafted message`, "aaron"),
      event("evt_decision_lisa", at(45), "human_decision", "human", `${MOCHI} confirmed`, "lisa"),
      event("evt_confirmed", at(45), "plan_state", "system", "Plan confirmed by both people"),
    ],
  };
}

function scheduled(): StateSnapshot {
  const prior = confirmed();
  const at = toCentralIso(toMs(prior.clock.now) + 5000);
  return {
    ...prior,
    clock: { now: at },
    threads: [{ ...prior.threads[0], state: "completed", updatedAt: at }],
    plans: [moveTo(prior.plans[0], "scheduled", at, "Calendar hold issued")],
    events: [
      ...prior.events,
      event("evt_hold", at, "hold_issued", "system", `Calendar hold issued for ${describeWindow(prior.plans[0].window!)}`),
    ],
  };
}

function reminded(): StateSnapshot {
  const prior = scheduled();
  const window = prior.plans[0].window!;
  const at = toCentralIso(toMs(window.start) - 2 * HOUR_MS);
  return {
    ...prior,
    clock: { now: at },
    plans: [moveTo(prior.plans[0], "reminded", at, "Reminder sent to both")],
    events: [
      ...prior.events,
      event("evt_clock_reminder", at, "clock_advanced", "system", "Demo clock moved to two hours before the plan"),
      event("evt_reminder", at, "plan_state", "agent", `${SPROUT} and ${MOCHI} reminded their people: Shawarma Point, ${describeWindow(window)}`),
    ],
  };
}

function happened(): StateSnapshot {
  const prior = reminded();
  const window = prior.plans[0].window!;
  const at = window.end;
  return {
    ...prior,
    clock: { now: at },
    plans: [moveTo(prior.plans[0], "happened", at, "The plan took place")],
    events: [
      ...prior.events,
      event("evt_clock_end", at, "clock_advanced", "system", "Demo clock moved to the end of the plan"),
      event("evt_followed_through", at, "followed_through", "human", `${SPROUT} and ${MOCHI} got shawarma together`),
    ],
  };
}

function followedUp(): StateSnapshot {
  const prior = happened();
  const at = toCentralIso(toMs(prior.plans[0].window!.end) + 14 * HOUR_MS);
  return {
    ...prior,
    clock: { now: at },
    plans: [moveTo(prior.plans[0], "followed_up", at, "Asked about next month")],
    events: [
      ...prior.events,
      event("evt_clock_next_day", at, "clock_advanced", "system", "Demo clock moved to the next morning"),
      event("evt_follow_up", at, "plan_state", "agent", "Both agents asked their people: again next month?"),
    ],
  };
}

// A person said no after the agents agreed.
function dropped(): StateSnapshot {
  const full = recordedSnapshot();
  const at = (seconds: number) => toCentralIso(toMs(full.clock.now) + seconds * 1000);
  const plan: Plan = {
    ...moveTo({ ...full.plans[0], decisions: { aaron: "pending", lisa: "declined" } }, "dropped", at(30), `${MOCHI} declined`),
    dropReason: "declined",
  };
  return {
    ...full,
    clock: { now: at(30) },
    threads: [{ ...full.threads[0], state: "rejected", dropReason: "declined", updatedAt: at(30) }],
    plans: [plan],
    cards: withStatus(full.cards, { lisa: "declined" }),
    events: [
      ...full.events,
      event("evt_declined", at(30), "human_decision", "human", `${MOCHI} passed on this one`, "lisa"),
      event("evt_dropped", at(30), "plan_state", "system", "Plan dropped: a person declined"),
    ],
  };
}

const BUILDERS: Record<PlanState, () => StateSnapshot> = {
  detected,
  negotiating,
  awaiting_humans: awaitingHumans,
  confirmed,
  scheduled,
  reminded,
  happened,
  followed_up: followedUp,
  dropped,
};

export function snapshotAtPlanState(state: PlanState): StateSnapshot {
  return structuredClone(BUILDERS[state]());
}
