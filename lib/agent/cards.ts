import type { AgentId, Plan, Recommendation } from "@/lib/protocol";
import { displayName } from "@/lib/seed/fixtures";
import { newId, otherAgent } from "./ids";
import { describeWindow } from "./windows";

// The one card each person sees once both agents agree. Built by code from the agreed activity and
// window, so the wording around a time is never the model's to get wrong.

function draftFor(initiator: AgentId, plan: Required<Pick<Plan, "activity" | "window">>): string {
  const friend = displayName(otherAgent(initiator));
  return `Hey ${friend}, ${plan.activity.title} came up and ${describeWindow(plan.window)} works for both of us. Want to go?`;
}

export function buildCards(plan: Plan, at: string): Recommendation[] {
  if (!plan.activity || !plan.window) return [];
  const agreed = { activity: plan.activity, window: plan.window };
  const when = describeWindow(plan.window);
  return plan.participants.map((agent) => {
    const friend = otherAgent(agent);
    const initiator = agent === plan.initiator;
    return {
      id: newId("card"),
      planId: plan.id,
      forAgent: agent,
      friend,
      text: initiator
        ? `You and ${displayName(friend)} both want to try ${plan.activity!.title}, and you're both free ${when}. Reach out?`
        : `${displayName(friend)} and you agreed on ${plan.activity!.title}, ${when}. Expect a message from ${displayName(friend)} and confirm when it lands.`,
      activity: agreed.activity,
      window: agreed.window,
      draft: initiator ? draftFor(agent, agreed) : undefined,
      status: "pending",
      createdAt: at,
    };
  });
}
