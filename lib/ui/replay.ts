import { PLAN_STATES, type AgentId, type Decision, type Plan, type PlanState, type RecordedRun, type StateSnapshot, type Thread } from "@/lib/protocol";
import { toUiSnapshot } from "./snapshot";
import type { UiSnapshot } from "./types";

/*
 * Replay: a recorded run played back from the store. A run is the final
 * StateSnapshot, and every message, event, and plan transition in it carries a
 * time, so the state at any moment can be rebuilt from it. Frames are built on
 * the server (the seed's calendars never reach a browser bundle) and played on
 * the client, so a replay keeps going even if the network drops after it loads.
 * Server-only: it uses the adapter.
 */

export type ReplayFrame = { snapshot: UiSnapshot; holdMs: number };

export type Replay = { id: string; label: string; source: RecordedRun["source"]; frames: ReplayFrame[] };

const ms = (iso: string) => Date.parse(iso);

/** The plan states in the order a plan passes through them; `dropped` is a branch, so it ranks with where it stopped. */
const PROGRESS: PlanState[] = PLAN_STATES.filter((state) => state !== "dropped");

export function progressOf(snapshot: StateSnapshot): number {
  const plan = snapshot.plans.at(-1);
  if (!plan) return -1;
  const reached = plan.history.filter((entry) => entry.state !== "dropped").map((entry) => PROGRESS.indexOf(entry.state));
  return Math.max(-1, ...reached);
}

/** Every moment something happened in the run, oldest first. */
export function beatTimes(run: StateSnapshot): number[] {
  const times = new Set<number>();
  for (const record of run.messages) times.add(ms(record.message.at));
  for (const event of run.events) times.add(ms(event.at));
  for (const plan of run.plans) for (const entry of plan.history) times.add(ms(entry.at));
  return [...times].filter((time) => !Number.isNaN(time)).sort((a, b) => a - b);
}

function decisionsAt(events: StateSnapshot["events"]): Record<AgentId, Decision> {
  const decisions: Record<AgentId, Decision> = { aaron: "pending", lisa: "pending" };
  for (const event of events) {
    if (event.kind !== "human_decision" || !event.agent) continue;
    decisions[event.agent] = /passed on this one|declined/i.test(event.text) ? "declined" : "accepted";
  }
  return decisions;
}

function planAt(plan: Plan, events: StateSnapshot["events"], time: number): Plan | null {
  const history = plan.history.filter((entry) => ms(entry.at) <= time);
  if (history.length === 0) return null;
  const state = history.at(-1)!.state;
  return {
    ...plan,
    state,
    history,
    decisions: decisionsAt(events.filter((event) => event.planId === plan.id || event.contextId === plan.contextId)),
    dropReason: state === "dropped" ? plan.dropReason : undefined,
  };
}

/** The run as it stood at `time`: only what had happened by then, with the plan, thread, and cards to match. */
export function stateAt(run: StateSnapshot, time: number): StateSnapshot {
  const messages = run.messages.filter((record) => ms(record.message.at) <= time);
  const events = run.events.filter((event) => ms(event.at) <= time);
  const plans = run.plans.flatMap((plan) => {
    const visible = planAt(plan, events, time);
    return visible ? [visible] : [];
  });
  const plan = plans.at(-1);

  const threads = run.threads.flatMap((thread) => {
    const shown = messages.filter((record) => record.message.contextId === thread.contextId).length;
    const opened = events.some((event) => event.kind === "thread_opened" && event.contextId === thread.contextId);
    if (shown === 0 && !opened) return [];
    const finished = shown >= thread.messageCount;
    const scheduledOrLater = plan !== undefined && PROGRESS.indexOf(plan.state) >= PROGRESS.indexOf("scheduled");
    const state: Thread["state"] = !finished ? "working" : plan?.state === "dropped" || scheduledOrLater ? thread.state : "input-required";
    return [{ ...thread, messageCount: shown, state }];
  });

  const awaitingOrLater = plan !== undefined && plan.state !== "detected" && plan.state !== "negotiating";
  const cards = awaitingOrLater ? run.cards.map((card) => ({ ...card, status: plan.decisions[card.forAgent as AgentId] ?? card.status })) : [];

  return {
    ...run,
    clock: { now: new Date(time).toISOString() },
    messages,
    events,
    redactions: run.redactions.filter((redaction) => ms(redaction.at) <= time),
    plans,
    threads,
    cards,
  };
}

/** How long a frame stays up: the recorded gap, shortened, kept readable. A clock jump (hours or days) gets a flat beat. */
export function holdFor(gapMs: number): number {
  if (gapMs > 3_600_000) return 1800;
  return Math.min(2600, Math.max(900, Math.round(gapMs * 0.6)));
}

/** Every frame of a recorded run, starting from the empty stage and ending on the last state; consecutive duplicates are merged. */
export function buildReplay(run: RecordedRun): Replay {
  const beats = beatTimes(run.snapshot);
  const times = beats.length > 0 ? [beats[0] - 1, ...beats] : [Date.now()];
  const frames: ReplayFrame[] = [];
  let previous = "";
  times.forEach((time, index) => {
    const snapshot = toUiSnapshot(stateAt(run.snapshot, time), { mode: "replay" });
    const holdMs = index < times.length - 1 ? holdFor(times[index + 1] - time) : 0;
    const key = JSON.stringify({ ...snapshot, now: undefined });
    if (key === previous && frames.length > 0) {
      frames[frames.length - 1].holdMs += holdMs;
      return;
    }
    previous = key;
    frames.push({ snapshot, holdMs });
  });
  return { id: run.id, label: run.label, source: run.source, frames };
}

/** Of the runs saved in the store, the one that got furthest (a live run wins a tie, then the newest). Null when none qualifies. */
export function pickRun(runs: RecordedRun[]): RecordedRun | null {
  const ranked = runs
    .map((run) => ({ run, progress: progressOf(run.snapshot) }))
    .filter((entry) => entry.progress >= 0)
    .sort((a, b) => b.progress - a.progress || Number(b.run.source === "live") - Number(a.run.source === "live") || ms(b.run.recordedAt) - ms(a.run.recordedAt));
  return ranked[0]?.run ?? null;
}
