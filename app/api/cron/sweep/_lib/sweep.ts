import { advanceClock, nextStepDue } from "@/lib/agent/lifecycle";
import { newId } from "@/lib/agent/ids";
import { toCentralIso } from "@/lib/agent/windows";
import type { Plan } from "@/lib/protocol";
import type { Store } from "@/lib/store";

export type SweepTransition = { planId: string; step: string; from: Plan["state"]; to: Plan["state"] };

export type SweepResult = {
  at: string;
  checked: number;
  advanced: number;
  skipped: number;
  transitions: SweepTransition[];
};

// Moves every plan whose next step (the reminder, the end, the next-day follow-up) is already due in
// real time. It decides nothing itself: lifecycle.ts says which step is due (nextStepDue) and runs it
// (advanceClock), so the sweep and the demo clock cannot disagree about what a step is.
//
// Idempotent: a plan that has been moved no longer has a due step, so a second run, or a duplicate
// delivery of the same cron call, finds nothing to do. One step per call, so each transition writes
// exactly one Activity row stamped "Scheduled", and the people see in the timeline that a scheduled
// run, not a tap, moved the plan.
export async function sweepPlans(store: Store, nowMs: number): Promise<SweepResult> {
  const plans = await store.listPlans();
  const transitions: SweepTransition[] = [];
  let skipped = 0;

  for (const listed of plans) {
    let plan = listed;
    for (let guard = 0; guard < 4; guard += 1) {
      const step = nextStepDue(plan, nowMs);
      if (!step) break;
      const moved = await advanceClock(store, { planId: plan.id, step }, { wallNow: () => nowMs });
      if (!moved.ok) {
        skipped += 1;
        break;
      }
      const before = plan.state;
      plan = moved.value.plan;
      transitions.push({ planId: plan.id, step, from: before, to: plan.state });
      const at = toCentralIso(nowMs);
      await store.appendEvent({
        id: newId("evt", nowMs),
        at,
        kind: "plan_state",
        actor: "system",
        contextId: plan.contextId,
        planId: plan.id,
        text: `Scheduled sweep: ${plan.activity?.title ?? "the plan"} moved from ${before} to ${plan.state}`,
      });
    }
  }

  return { at: toCentralIso(nowMs), checked: plans.length, advanced: transitions.length, skipped, transitions };
}
