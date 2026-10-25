import type { ActivityEvent, AgentId, Plan, Recommendation, StateSnapshot } from "@/lib/protocol";
import { displayName } from "@/lib/seed/fixtures";
import { transitionPlan } from "@/lib/plans";
import type { Store } from "@/lib/store";
import { newId, otherAgent } from "./ids";
import { describeWindow, toCentralIso, toMs } from "./windows";

// What happens to a plan after the agents agree: the humans decide, the hold is issued, and the demo
// clock carries it through the reminder, the day itself, and the next-day follow-up. Every function
// returns a result instead of throwing, so a route can map it straight to a status code.

export type LifecycleResult<T> = { ok: true; value: T } | { ok: false; status: 404 | 409 | 422; error: string };

const HOUR_MS = 3_600_000;
const REMINDER_LEAD_HOURS = 2;
const FOLLOW_UP_AFTER_HOURS = 14;

type Options = { wallNow?: () => number };

function row(
  plan: Plan,
  at: string,
  kind: ActivityEvent["kind"],
  actor: ActivityEvent["actor"],
  text: string,
  extra: Partial<ActivityEvent> = {},
): ActivityEvent {
  return { id: newId("evt", toMs(at)), at, kind, actor, contextId: plan.contextId, planId: plan.id, text, ...extra };
}

async function setThreadState(store: Store, contextId: string, state: "completed" | "rejected", at: string) {
  const thread = await store.getThread(contextId);
  if (thread) await store.putThread({ ...thread, state, dropReason: state === "rejected" ? "declined" : thread.dropReason, updatedAt: at });
}

// The plan the controls act on when no id is given: the most recent one still alive.
export async function currentPlan(store: Store): Promise<Plan | null> {
  const plans = await store.listPlans();
  return [...plans].reverse().find((plan) => plan.state !== "dropped") ?? null;
}

async function issueHold(store: Store, plan: Plan, at: string): Promise<Plan> {
  const scheduled = transitionPlan(plan, "scheduled", at, { note: "Calendar hold issued" });
  await store.putPlan(scheduled);
  await setThreadState(store, plan.contextId, "completed", at);
  await store.appendEvent(row(plan, at, "hold_issued", "system", `Calendar hold issued for ${describeWindow(plan.window!)}`));
  return scheduled;
}

// A person taps yes or no on their card. Either person may go first. A no drops the plan; two yeses
// confirm it, and the agents issue the calendar hold straight away.
export async function decide(
  store: Store,
  input: { planId: string; agent: AgentId; choice: "accept" | "decline" },
  options: Options = {},
): Promise<LifecycleResult<{ plan: Plan; cards: Recommendation[] }>> {
  const plan = await store.getPlan(input.planId);
  if (!plan) return { ok: false, status: 404, error: "no such plan" };
  if (plan.state !== "awaiting_humans") return { ok: false, status: 409, error: `the plan is ${plan.state}, not waiting for a decision` };
  if (!plan.participants.includes(input.agent)) return { ok: false, status: 422, error: "that person is not part of this plan" };
  if (plan.decisions[input.agent] !== "pending") return { ok: false, status: 409, error: "this person already decided" };

  const at = toCentralIso(options.wallNow?.() ?? Date.now());
  const accepted = input.choice === "accept";
  let next: Plan = { ...plan, decisions: { ...plan.decisions, [input.agent]: accepted ? "accepted" : "declined" }, updatedAt: at };

  const cards = (await store.listCards({ planId: plan.id })).map((card) =>
    card.forAgent === input.agent ? { ...card, status: accepted ? ("accepted" as const) : ("declined" as const) } : card,
  );
  for (const card of cards) await store.putCard(card);
  await store.appendEvent(
    row(plan, at, "human_decision", "human", accepted ? `${displayName(input.agent)} said yes to ${plan.activity?.title ?? "the plan"}` : `${displayName(input.agent)} passed on this one`, { agent: input.agent }),
  );

  if (!accepted) {
    next = { ...transitionPlan(next, "dropped", at, { note: `${displayName(input.agent)} declined`, dropReason: "declined" }) };
    await store.putPlan(next);
    await setThreadState(store, plan.contextId, "rejected", at);
    await store.appendEvent(row(plan, at, "plan_state", "system", "Plan dropped: a person declined"));
    return { ok: true, value: { plan: next, cards } };
  }

  if (Object.values(next.decisions).every((decision) => decision === "accepted")) {
    next = transitionPlan(next, "confirmed", at, { note: "Both people said yes" });
    await store.putPlan(next);
    await store.appendEvent(row(plan, at, "plan_state", "system", "Plan confirmed by both people"));
    next = await issueHold(store, next, at);
  } else {
    await store.putPlan(next);
  }
  return { ok: true, value: { plan: next, cards } };
}

// A person opened the WhatsApp handoff (or copied the draft). The human sends; the agent only drafts.
export async function recordHandoff(
  store: Store,
  input: { planId: string; agent: AgentId; via: "whatsapp" | "copy" },
  options: Options = {},
): Promise<LifecycleResult<{ draft: string }>> {
  const plan = await store.getPlan(input.planId);
  if (!plan) return { ok: false, status: 404, error: "no such plan" };
  if (!plan.draft) return { ok: false, status: 409, error: "this plan has no drafted message yet" };
  const at = toCentralIso(options.wallNow?.() ?? Date.now());
  const text =
    input.via === "whatsapp"
      ? `${displayName(input.agent)} opened WhatsApp with the drafted message`
      : `${displayName(input.agent)} copied the drafted message`;
  await store.appendEvent(row(plan, at, "handoff_opened", "human", text, { agent: input.agent }));
  return { ok: true, value: { draft: plan.draft } };
}

export type ClockStep = "next" | "reminder" | "end" | "next_day";

const STEP_FOR_STATE: Partial<Record<Plan["state"], Exclude<ClockStep, "next">>> = {
  scheduled: "reminder",
  reminded: "end",
  happened: "next_day",
};

// Moves the demo clock to the next moment of the plan's life and runs what happens there. The clock
// only moves forward. "reminder" is two hours before the plan, "end" is when it finishes, "next_day"
// is the following morning.
export async function advanceClock(
  store: Store,
  input: { step?: ClockStep; planId?: string } = {},
): Promise<LifecycleResult<{ clock: StateSnapshot["clock"]; plan: Plan }>> {
  const plan = input.planId ? await store.getPlan(input.planId) : await currentPlan(store);
  if (!plan) return { ok: false, status: 404, error: "no plan to move forward" };
  if (!plan.window) return { ok: false, status: 409, error: "the plan has no time yet" };

  const wanted = STEP_FOR_STATE[plan.state];
  const step = !input.step || input.step === "next" ? wanted : input.step;
  if (!step || step !== wanted) return { ok: false, status: 409, error: `the plan is ${plan.state}; the clock cannot move to ${input.step ?? "next"} from here` };

  const startMs = toMs(plan.window.start);
  const endMs = toMs(plan.window.end);
  const current = toMs((await store.getClock()).now);
  const targetMs = step === "reminder" ? startMs - REMINDER_LEAD_HOURS * HOUR_MS : step === "end" ? endMs : endMs + FOLLOW_UP_AFTER_HOURS * HOUR_MS;
  const at = toCentralIso(Math.max(current, targetMs));
  const clock = { now: at };
  await store.setClock(clock);

  const title = plan.activity?.title ?? "the plan";
  const when = describeWindow(plan.window);
  const [first, second] = plan.participants;

  if (step === "reminder") {
    await store.appendEvent(row(plan, at, "clock_advanced", "system", "Demo clock moved to two hours before the plan"));
    for (const agent of [first, second]) {
      await store.appendEvent(row(plan, at, "plan_state", "agent", `${displayName(agent)} reminded their person: ${title} with ${displayName(otherAgent(agent))}, ${when}`, { agent }));
    }
    const next = transitionPlan(plan, "reminded", at, { note: "Reminder sent to both" });
    await store.putPlan(next);
    return { ok: true, value: { clock, plan: next } };
  }

  if (step === "end") {
    await store.appendEvent(row(plan, at, "clock_advanced", "system", "Demo clock moved to the end of the plan"));
    // The Follow-through counter counts this event and nothing an agent does.
    await store.appendEvent(row(plan, at, "followed_through", "human", `${displayName(first)} and ${displayName(second)} got together for ${title}`));
    const next = transitionPlan(plan, "happened", at, { note: "The plan took place" });
    await store.putPlan(next);
    return { ok: true, value: { clock, plan: next } };
  }

  await store.appendEvent(row(plan, at, "clock_advanced", "system", "Demo clock moved to the next morning"));
  for (const agent of [first, second]) {
    await store.appendEvent(row(plan, at, "plan_state", "agent", `${displayName(agent)} asked their person: want to do ${title} with ${displayName(otherAgent(agent))} again next month?`, { agent }));
  }
  const next = transitionPlan(plan, "followed_up", at, { note: "Asked about next month" });
  await store.putPlan(next);
  return { ok: true, value: { clock, plan: next } };
}
