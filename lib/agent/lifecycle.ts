import { membersOfPlan, type ActivityEvent, type Decision, type MemberId, type Plan, type Recommendation, type StateSnapshot } from "@/lib/protocol";
import { displayName } from "@/lib/seed/fixtures";
import { transitionPlan } from "@/lib/plans";
import type { Store } from "@/lib/store";
import { namesOf } from "./group";
import { newId, seatOf } from "./ids";
import { PLAN_LOCK, withLock } from "./lock";
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

// The agents issue the calendar hold: confirmed -> scheduled, thread completed. The people opening the
// WhatsApp draft triggers it; the clock does it too if nobody has, so the demo cannot stall.
export async function scheduleHold(store: Store, given: Plan, at: string): Promise<Plan> {
  // Re-read so a second caller (a double-opened draft) finds the hold already issued and adds nothing.
  const plan = (await store.getPlan(given.id)) ?? given;
  if (plan.state !== "confirmed") return plan;
  const scheduled = transitionPlan(plan, "scheduled", at, { note: "Calendar hold issued" });
  await store.putPlan(scheduled);
  await setThreadState(store, plan.contextId, "completed", at);
  await store.appendEvent(row(plan, at, "hold_issued", "system", `Calendar hold issued for ${describeWindow(plan.window!)}`));
  return scheduled;
}

// Folds the people's answers into the plan. Each person's answer lives on their own card (a row only
// they write), and the plan's `decisions` are rebuilt from the cards, so two taps at once, even on two
// server instances, cannot erase each other: whoever runs last sees both cards and finishes the job.
// A no drops the plan; two yeses confirm it. Loops until a re-read shows nothing left to change.
// What each member of a plan has answered. A pair keeps its answers in Plan.decisions; a group keeps all three in
// Plan.group.decisions and mirrors the two phone seats into Plan.decisions, so everything that reads that works.
function decisionsOf(plan: Plan): Partial<Record<MemberId, Decision>> {
  return plan.group ? { ...plan.decisions, ...plan.group.decisions } : { ...plan.decisions };
}

function withDecisions(plan: Plan, decisions: Partial<Record<MemberId, Decision>>): Plan {
  const seats = { aaron: decisions.aaron ?? plan.decisions.aaron, lisa: decisions.lisa ?? plan.decisions.lisa };
  return plan.group ? { ...plan, decisions: seats, group: { ...plan.group, decisions } } : { ...plan, decisions: seats };
}

export async function reconcilePlan(store: Store, planId: string, at: string): Promise<Plan | null> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const plan = await store.getPlan(planId);
    if (!plan) return null;
    const members = membersOfPlan(plan);
    const cards = await store.listCards({ planId });
    const decisions = decisionsOf(plan);
    for (const card of cards) if (card.status !== "pending") decisions[card.forAgent] = card.status;

    let next: Plan = withDecisions(plan, decisions);
    const declinedBy = members.find((member) => decisions[member] === "declined");
    const everyone = members.length === 2 ? "Both people said yes" : `All ${members.length} people said yes`;
    if (plan.state === "awaiting_humans" && declinedBy) {
      next = transitionPlan(next, "dropped", at, { note: `${displayName(declinedBy)} declined`, dropReason: "declined" });
    } else if (plan.state === "awaiting_humans" && members.every((member) => decisions[member] === "accepted")) {
      next = transitionPlan(next, "confirmed", at, { note: everyone });
    }

    const unchanged = next.state === plan.state && JSON.stringify(next.decisions) === JSON.stringify(plan.decisions) && JSON.stringify(next.group) === JSON.stringify(plan.group);
    if (unchanged) return plan;
    await store.putPlan(next);
    if (next.state === "dropped" && plan.state !== "dropped") {
      await Promise.all((plan.group ? Object.values(plan.group.contexts) : [plan.contextId]).map((contextId) => setThreadState(store, contextId!, "rejected", at)));
      await store.appendEvent(row(plan, at, "plan_state", "system", "Plan dropped: a person declined"));
    } else if (next.state === "confirmed" && plan.state !== "confirmed") {
      await store.appendEvent(row(plan, at, "plan_state", "system", members.length === 2 ? "Plan confirmed by both people" : `Plan confirmed by all ${members.length} people`));
    }
  }
  return store.getPlan(planId);
}

// A person taps yes or no on their card. Anyone in the plan may go first. The hold follows when the draft
// is opened (recordHandoff) or the clock moves on.
export function decide(
  store: Store,
  input: { planId: string; agent: MemberId; choice: "accept" | "decline" },
  options: Options = {},
): Promise<LifecycleResult<{ plan: Plan; cards: Recommendation[] }>> {
  return withLock(PLAN_LOCK, async () => {
    const plan = await store.getPlan(input.planId);
    if (!plan) return { ok: false, status: 404, error: "no such plan" } as const;
    if (plan.state !== "awaiting_humans") return { ok: false, status: 409, error: `the plan is ${plan.state}, not waiting for a decision` } as const;
    if (!membersOfPlan(plan).includes(input.agent)) return { ok: false, status: 422, error: "that person is not part of this plan" } as const;
    // A trip is joined with a deposit: a yes without one would skip the pot, so only the trip engine may record it.
    if (plan.kind === "trip" && input.choice === "accept" && plan.trip?.pot?.deposits[input.agent]?.status !== "confirmed") {
      return { ok: false, status: 409, error: "a trip needs this person's pot deposit first" } as const;
    }
    const ownCard = (await store.listCards({ planId: plan.id, forAgent: input.agent }))[0];
    if (decisionsOf(plan)[input.agent] !== "pending" || (ownCard && ownCard.status !== "pending")) {
      return { ok: false, status: 409, error: "this person already decided" } as const;
    }

    const at = toCentralIso(options.wallNow?.() ?? Date.now());
    const accepted = input.choice === "accept";
    const status = accepted ? ("accepted" as const) : ("declined" as const);

    // The person's own row first: it is the durable record, and no one else writes it.
    if (ownCard) await store.putCard({ ...ownCard, status });
    await store.putPlan({ ...withDecisions(plan, { ...decisionsOf(plan), [input.agent]: status }), updatedAt: at });
    await store.appendEvent(
      row(plan, at, "human_decision", "human", accepted ? `${displayName(input.agent)} said yes to ${plan.activity?.title ?? "the plan"}` : `${displayName(input.agent)} passed on this one`, { agent: seatOf(input.agent) }),
    );

    const settled = (await reconcilePlan(store, plan.id, at)) ?? plan;
    return { ok: true, value: { plan: settled, cards: await store.listCards({ planId: plan.id }) } } as const;
  });
}

// A person opened the WhatsApp handoff (or copied the draft). The human sends; the agent only drafts.
// Once the plan is confirmed, this is also the moment the agents issue the calendar hold.
export function recordHandoff(
  store: Store,
  input: { planId: string; agent: MemberId; via: "whatsapp" | "copy" },
  options: Options = {},
): Promise<LifecycleResult<{ draft: string; plan: Plan }>> {
  return withLock(PLAN_LOCK, () => recordHandoffLocked(store, input, options));
}

async function recordHandoffLocked(
  store: Store,
  input: { planId: string; agent: MemberId; via: "whatsapp" | "copy" },
  options: Options,
): Promise<LifecycleResult<{ draft: string; plan: Plan }>> {
  const plan = await store.getPlan(input.planId);
  if (!plan) return { ok: false, status: 404, error: "no such plan" };
  if (!plan.draft) return { ok: false, status: 409, error: "this plan has no drafted message yet" };
  const at = toCentralIso(options.wallNow?.() ?? Date.now());
  const text =
    input.via === "whatsapp"
      ? `${displayName(input.agent)} opened WhatsApp with the drafted message`
      : `${displayName(input.agent)} copied the drafted message`;
  await store.appendEvent(row(plan, at, "handoff_opened", "human", text, { agent: seatOf(input.agent) }));
  const current = plan.state === "confirmed" ? await scheduleHold(store, plan, at) : plan;
  return { ok: true, value: { draft: plan.draft, plan: current } };
}

export type ClockStep = "next" | "reminder" | "end" | "next_day";

type RealStep = Exclude<ClockStep, "next">;

const ORDER: RealStep[] = ["reminder", "end", "next_day"];
const STEP_FOR_STATE: Partial<Record<Plan["state"], RealStep>> = {
  confirmed: "reminder",
  scheduled: "reminder",
  reminded: "end",
  happened: "next_day",
};

// When each step happens: the reminder is two hours before the plan, "end" is when it finishes, and
// the follow-up is the next morning.
function momentOf(step: RealStep, window: NonNullable<Plan["window"]>): number {
  if (step === "reminder") return toMs(window.start) - REMINDER_LEAD_HOURS * HOUR_MS;
  if (step === "end") return toMs(window.end);
  return toMs(window.end) + FOLLOW_UP_AFTER_HOURS * HOUR_MS;
}

// The step the clock would run next for this plan, if its moment has already passed in real time.
// The scheduled sweep (app/api/cron/sweep) asks this, so it never decides a time of its own.
export function nextStepDue(plan: Plan, nowMs: number): RealStep | null {
  const step = STEP_FOR_STATE[plan.state];
  if (!step || !plan.window) return null;
  return nowMs >= momentOf(step, plan.window) ? step : null;
}

// Moves the demo clock forward through the plan's life and runs what happens at each moment.
// "reminder" is two hours before the plan, "end" is when it finishes, "next_day" is the following
// morning; "next" (the default) is whichever comes next. Naming a later step runs the ones in
// between, so a two-button control can jump from scheduled straight to the follow-up. A confirmed
// plan that never had its hold issued gets it first. The clock only moves forward.
// `from` makes the call idempotent: the automatic time skip on every open phone names the state it saw,
// and only the first call finds the plan still there; the rest change nothing (`changed: false`).
export function advanceClock(
  store: Store,
  input: { step?: ClockStep; planId?: string; from?: Plan["state"] } = {},
  options: Options = {},
): Promise<LifecycleResult<{ clock: StateSnapshot["clock"]; plan: Plan; changed: boolean }>> {
  return withLock(PLAN_LOCK, () => advanceClockLocked(store, input, options));
}

async function advanceClockLocked(
  store: Store,
  input: { step?: ClockStep; planId?: string; from?: Plan["state"] },
  options: Options,
): Promise<LifecycleResult<{ clock: StateSnapshot["clock"]; plan: Plan; changed: boolean }>> {
  const found = input.planId ? await store.getPlan(input.planId) : await currentPlan(store);
  if (!found) return { ok: false, status: 404, error: "no plan to move forward" };
  if (input.from && found.state !== input.from) return { ok: true, value: { clock: await store.getClock(), plan: found, changed: false } };
  if (!found.window) return { ok: false, status: 409, error: "the plan has no time yet" };

  const wanted = STEP_FOR_STATE[found.state];
  const requested = !input.step || input.step === "next" ? wanted : input.step;
  if (!wanted || !requested || ORDER.indexOf(requested) < ORDER.indexOf(wanted)) {
    return { ok: false, status: 409, error: `the plan is ${found.state}; the clock cannot move to ${input.step ?? "next"} from here` };
  }

  let plan = found.state === "confirmed" ? await scheduleHold(store, found, toCentralIso(options.wallNow?.() ?? Date.now())) : found;
  let last: LifecycleResult<{ clock: StateSnapshot["clock"]; plan: Plan }> = { ok: false, status: 409, error: "nothing to do" };
  for (let index = ORDER.indexOf(STEP_FOR_STATE[plan.state]!); index <= ORDER.indexOf(requested); index += 1) {
    last = await runStep(store, plan, ORDER[index]);
    if (!last.ok) return last;
    plan = last.value.plan;
  }
  return last.ok ? { ok: true, value: { ...last.value, changed: true } } : last;
}

async function runStep(store: Store, plan: Plan, step: RealStep): Promise<LifecycleResult<{ clock: StateSnapshot["clock"]; plan: Plan }>> {
  if (!plan.window) return { ok: false, status: 409, error: "the plan has no time yet" };

  const current = toMs((await store.getClock()).now);
  const targetMs = momentOf(step, plan.window);
  const at = toCentralIso(Math.max(current, targetMs));
  const clock = { now: at };
  await store.setClock(clock);

  const title = plan.activity?.title ?? "the plan";
  const when = describeWindow(plan.window);
  const members = membersOfPlan(plan);
  const withOthers = (member: MemberId) => namesOf(members.filter((other) => other !== member));

  if (step === "reminder") {
    await store.appendEvent(row(plan, at, "clock_advanced", "system", "Demo clock moved to two hours before the plan"));
    for (const member of members) {
      await store.appendEvent(row(plan, at, "plan_state", "agent", `${displayName(member)} reminded their person: ${title} with ${withOthers(member)}, ${when}`, { agent: seatOf(member) }));
    }
    const next = transitionPlan(plan, "reminded", at, { note: members.length === 2 ? "Reminder sent to both" : `Reminder sent to all ${members.length}` });
    await store.putPlan(next);
    return { ok: true, value: { clock, plan: next } };
  }

  if (step === "end") {
    await store.appendEvent(row(plan, at, "clock_advanced", "system", "Demo clock moved to the end of the plan"));
    // No followed_through here: only a person's "We went!" tap (the outcome route) counts for the KPI.
    const next = transitionPlan(plan, "happened", at, { note: "The plan took place" });
    await store.putPlan(next);
    return { ok: true, value: { clock, plan: next } };
  }

  await store.appendEvent(row(plan, at, "clock_advanced", "system", "Demo clock moved to the next morning"));
  for (const member of members) {
    await store.appendEvent(row(plan, at, "plan_state", "agent", `${displayName(member)} asked their person whether they made it to ${title} with ${withOthers(member)}`, { agent: seatOf(member) }));
  }
  const next = transitionPlan(plan, "followed_up", at, { note: "Asked about next month" });
  await store.putPlan(next);
  return { ok: true, value: { clock, plan: next } };
}
