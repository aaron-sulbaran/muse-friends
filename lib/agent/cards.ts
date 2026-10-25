import type { MemberId, Plan, Recommendation } from "@/lib/protocol";
import { displayName } from "@/lib/seed/fixtures";
import { newId, otherAgent } from "./ids";
import { describeWindow } from "./windows";

// The one card each person sees once both agents agree. Built by code from the agreed activity and
// window, so the wording around a time is never the model's to get wrong.

function draftFor(initiator: MemberId, plan: Required<Pick<Plan, "activity" | "window">>): string {
  const friend = displayName(otherAgent(initiator));
  return `Hey ${friend}, ${plan.activity.title} came up and ${describeWindow(plan.window)} works for both of us. Want to go?`;
}

export function buildCards(plan: Plan, at: string): Recommendation[] {
  if (!plan.activity || !plan.window) return [];
  if (plan.group) return buildGroupCards(plan, at);
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

// One group card per person. The coordinator's carries the drafted message to the others.
function buildGroupCards(plan: Plan, at: string): Recommendation[] {
  const group = plan.group!;
  const when = describeWindow(plan.window!);
  const title = plan.activity!.title;
  const others = group.members.filter((member) => member !== group.coordinator);
  return group.members.map((member) => {
    const isCoordinator = member === group.coordinator;
    const rest = group.members.filter((candidate) => candidate !== member);
    return {
      id: newId("card"),
      planId: plan.id,
      forAgent: member,
      friend: isCoordinator ? others[0] : group.coordinator,
      group: { groupId: group.groupId, members: group.members },
      text: isCoordinator
        ? `You, ${displayName(others[0])} and ${displayName(others[1])} all want to try ${title}, and you're all free ${when}. Reach out?`
        : `${displayName(group.coordinator)} is getting ${displayName(rest.find((other) => other !== group.coordinator)!)} and you together for ${title}, ${when}. You're all free. Confirm when ${displayName(group.coordinator)} messages.`,
      activity: plan.activity!,
      window: plan.window!,
      draft: isCoordinator ? `Hey ${displayName(others[0])} and ${displayName(others[1])}, ${title} came up and ${when} works for all three of us. Want to go?` : undefined,
      status: "pending" as const,
      createdAt: at,
    };
  });
}
