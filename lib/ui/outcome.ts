import { PLAN_LOCK, withLock } from "@/lib/agent/lock";
import type { LifecycleResult } from "@/lib/agent/lifecycle";
import { newId } from "@/lib/agent/ids";
import type { ActivityEvent, Role } from "@/lib/protocol";
import { displayName, ROLE_TO_AGENT } from "@/lib/seed/fixtures";
import { pastSignal } from "@/lib/seed/past-signals";
import type { Store } from "@/lib/store";
import { chooseNextIdea, type NextIdeaChooser } from "./next-idea";

/*
 * A person says whether the plan happened. Only a "went" counts for the Follow-through KPI. The first
 * answer wins: both phones share it. Server-only.
 */

export type OutcomeInput = { planId: string; role: Role; result: "went" | "didnt" };
export type OutcomeRecorded = { result: "went" | "didnt"; nextIdeaId: string | null; chosenBy: "model" | "rule" | null };

export function recordOutcome(
  store: Store,
  input: OutcomeInput,
  options: { chooser?: NextIdeaChooser } = {},
): Promise<LifecycleResult<{ outcome: OutcomeRecorded }>> {
  return withLock(PLAN_LOCK, async () => {
    const plan = await store.getPlan(input.planId);
    if (!plan) return { ok: false, status: 404, error: "no such plan" } as const;
    if (plan.state !== "happened" && plan.state !== "followed_up") {
      return { ok: false, status: 409, error: `the plan is ${plan.state}; it has not happened yet` } as const;
    }
    const events = (await store.listEvents()).filter((event) => event.planId === plan.id);
    if (events.some((event) => event.kind === "followed_through" || event.id.startsWith("evt_outcome_didnt_"))) {
      return { ok: false, status: 409, error: "this plan already has an answer" } as const;
    }

    const at = (await store.getClock()).now;
    const title = plan.activity?.title ?? "the plan";
    const person = displayName(ROLE_TO_AGENT[input.role]);
    const friend = displayName(ROLE_TO_AGENT[input.role === "a" ? "b" : "a"]);
    const base = { at, contextId: plan.contextId, planId: plan.id };
    const suffix = newId("o").slice(2);

    if (input.result === "didnt") {
      await store.appendEvent({ ...base, id: `evt_outcome_didnt_${suffix}`, kind: "human_decision", actor: "human", text: `${person} said it didn't happen` } as ActivityEvent);
      return { ok: true, value: { outcome: { result: "didnt", nextIdeaId: null, chosenBy: null } } } as const;
    }

    await store.appendEvent({
      ...base,
      id: `evt_outcome_went_${suffix}`,
      kind: "followed_through",
      actor: "human",
      text: `${person} and ${friend} made it to ${title}`,
    } as ActivityEvent);
    const pick = await (options.chooser ?? chooseNextIdea)();
    const signal = pastSignal(pick.signalId);
    await store.appendEvent({
      ...base,
      id: `evt_next_${pick.signalId}_${pick.chosenBy}_${suffix}`.slice(0, 64),
      kind: "plan_state",
      actor: "agent",
      agent: "aaron",
      text: `${displayName("aaron")} picked the next idea from the chat: ${signal?.title ?? pick.signalId} (chosen by ${pick.chosenBy === "model" ? "Muse Spark" : "rule"})`,
    } as ActivityEvent);
    return { ok: true, value: { outcome: { result: "went", nextIdeaId: pick.signalId, chosenBy: pick.chosenBy } } } as const;
  });
}
