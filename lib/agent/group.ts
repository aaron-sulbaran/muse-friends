import type { ActivityEvent, AgentMessage, MemberId, Plan, PlanGroup, Signal, Window } from "@/lib/protocol";
import { displayName } from "@/lib/seed/fixtures";
import type { Store } from "@/lib/store";
import { ownFreeBlocks } from "./calendar";
import { withLock } from "./lock";
import { newId, seatOf } from "./ids";
import { describeWindow, intersectWindows, toCentralIso } from "./windows";

// A group of three: star topology. The coordinator's agent (the person who started it) opens one ordinary
// pair thread with each other member; every pair thread is the existing two-person protocol, unchanged, and
// the pair threads share a groupId. Code intersects every member's windows. The plan moves to
// awaiting_humans when every pair thread has agreed on the same window.
//
//   round 1   coordinator -> each member: intent with its own free windows
//             each member  -> coordinator: counter with the offered windows that are free for them
//   (code)    candidate windows = the coordinator's free time and every member's counter, intersected
//   round 2   coordinator -> each member: accept of one candidate window
//             each member  -> coordinator: accept of the same window
//
// Members only ever talk to the coordinator, so no member learns another member's windows, and each pair
// keeps its own share policy and the same privacy gates. A pair thread is capped at 6 messages as ever.

export const GROUP_MEMBERS: MemberId[] = ["aaron", "lisa", "kai"];
export const GROUP_COORDINATOR: MemberId = "aaron";

export function memberContexts(group: PlanGroup): Array<{ member: MemberId; contextId: string }> {
  return group.members.filter((member) => member !== group.coordinator).flatMap((member) => (group.contexts[member] ? [{ member, contextId: group.contexts[member]! }] : []));
}

// The plan a thread belongs to. A group plan answers to every one of its pair threads' contexts.
export async function planForContext(store: Store, contextId: string): Promise<Plan | null> {
  const direct = await store.getPlanByContext(contextId);
  if (direct) return direct;
  const plans = await store.listPlans();
  return plans.find((plan) => plan.group && Object.values(plan.group.contexts).includes(contextId)) ?? null;
}

export function namesOf(members: MemberId[]): string {
  const names = members.map(displayName);
  return names.length <= 2 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

// Starts a group plan for a reel the coordinator received: the plan (detected) with its group, one fresh
// context per other member, and the sharing settings the new pair needs. The threads open when the
// coordinator's first messages go out.
export async function startGroup(
  store: Store,
  signal: Signal,
  options: { wallNow?: () => number } = {},
): Promise<{ groupId: string; planId: string; contexts: PlanGroup["contexts"]; firstContextId: string }> {
  const now = options.wallNow?.() ?? Date.now();
  const at = toCentralIso(now);
  const groupId = newId("grp", now);
  const planId = newId("plan", now);
  const others = GROUP_MEMBERS.filter((member) => member !== GROUP_COORDINATOR);
  const contexts: PlanGroup["contexts"] = Object.fromEntries(others.map((member) => [member, newId("ctx", now)]));
  const firstContextId = contexts[others[0]]!;

  const group: PlanGroup = {
    groupId,
    coordinator: GROUP_COORDINATOR,
    members: [...GROUP_MEMBERS],
    contexts,
    decisions: Object.fromEntries(GROUP_MEMBERS.map((member) => [member, "pending"])) as PlanGroup["decisions"],
    // Round 1, the fan-out and the answers, is under way from the moment the group starts.
    rounds: 1,
    quorum: "all",
  };
  const plan: Plan = {
    id: planId,
    contextId: firstContextId,
    initiator: seatOf(GROUP_COORDINATOR) ?? "aaron",
    participants: ["aaron", "lisa"],
    state: "detected",
    decisions: { aaron: "pending", lisa: "pending" },
    group,
    history: [{ state: "detected", at, note: "Group plan requested" }],
    createdAt: at,
    updatedAt: at,
  };
  const row = (kind: ActivityEvent["kind"], actor: ActivityEvent["actor"], text: string): ActivityEvent => ({
    id: newId("evt", now),
    at,
    kind,
    actor,
    contextId: firstContextId,
    planId,
    text,
  });

  // Each pair keeps its own share policy. Sprout and Pebble have not been paired before, so open it up like the
  // two seeded friends; the others are untouched.
  const pair = (owner: MemberId, friend: MemberId) => ({ owner, friend, tier: "close" as const, categories: {} });
  const missing = (await Promise.all([store.getPolicy("aaron", "kai"), store.getPolicy("kai", "aaron")])).map((policy) => policy === null);
  await Promise.all([
    store.putSignal({ ...signal, receivedAt: at }),
    store.putPlan(plan),
    ...(missing[0] ? [store.putPolicy(pair("aaron", "kai"))] : []),
    ...(missing[1] ? [store.putPolicy(pair("kai", "aaron"))] : []),
  ]);
  await store.appendEvent(row("signal_received", "human", `${displayName(signal.from)} shared a reel with ${displayName(signal.to)}: "${signal.dmText ?? "we should go"}"`));
  await store.appendEvent(row("plan_state", "agent", `${displayName(GROUP_COORDINATOR)} is making this a plan for three, with ${namesOf(others)}`));
  return { groupId, planId, contexts, firstContextId };
}

// What is in each pair thread: the last message of any kind (to tell whether the member or the coordinator spoke
// last), and the last message the member themselves sent (their offer, which does not change when the
// coordinator answers it).
async function latestFromEachMember(
  store: Store,
  group: PlanGroup,
): Promise<Array<{ member: MemberId; contextId: string; thread: Awaited<ReturnType<Store["getThread"]>>; last: AgentMessage | undefined; lastFromMember: AgentMessage | undefined }>> {
  return Promise.all(
    memberContexts(group).map(async ({ member, contextId }) => {
      const [thread, records] = await Promise.all([store.getThread(contextId), store.listMessages(contextId)]);
      const messages = records.map((record) => record.message);
      return { member, contextId, thread, last: messages.at(-1), lastFromMember: messages.filter((message) => message.from === member).at(-1) };
    }),
  );
}

// Has every member answered round 1? That is: each pair thread is still open and its last message is the
// member's. The coordinator waits for this before it decides anything.
export async function groupReady(store: Store, plan: Plan): Promise<boolean> {
  if (!plan.group) return false;
  const answers = await latestFromEachMember(store, plan.group);
  return answers.length === plan.group.members.length - 1 && answers.every(({ member, thread, last }) => thread?.state === "working" && last?.from === member);
}

// Windows that work for everyone, worked out in code: the coordinator's own free time intersected with
// the windows each member offered back. The model chooses among these; it cannot invent one.
export async function groupCandidates(store: Store, plan: Plan): Promise<Window[]> {
  const group = plan.group;
  if (!group) return [];
  let candidates = await ownFreeBlocks(store, group.coordinator);
  for (const { lastFromMember } of await latestFromEachMember(store, group)) {
    candidates = intersectWindows(candidates, lastFromMember?.windows ?? []);
  }
  return candidates;
}

export function describeCandidates(candidates: Window[]): string {
  return candidates.length === 0 ? "none" : candidates.map((window) => `${describeWindow(window)} [${window.start} to ${window.end}]`).join("; ");
}

// Every pair thread agreed? Then the group is done negotiating.
export async function allPairsAgreed(store: Store, group: PlanGroup): Promise<boolean> {
  const threads = await Promise.all(memberContexts(group).map(({ contextId }) => store.getThread(contextId)));
  return threads.length === group.members.length - 1 && threads.every((thread) => thread?.state === "input-required");
}

// Decides, once and under the group's lock, whether the coordinator's round-2 turn should run now: every
// friend has answered round 1 and round 2 has not started. Returns true to exactly one caller.
export async function claimCoordinatorTurn(store: Store, planId: string): Promise<boolean> {
  const probe = await store.getPlan(planId);
  if (!probe?.group) return false;
  return withLock(`group:${probe.group.groupId}`, async () => {
    const plan = await store.getPlan(planId);
    if (!plan?.group || plan.group.rounds !== 1 || plan.state !== "negotiating") return false;
    if (!(await groupReady(store, plan))) return false;
    await store.putPlan({ ...plan, group: { ...plan.group, rounds: 2 } });
    return true;
  });
}

// The answers the coordinator is deciding on: the latest message each friend sent.
export async function groupReplies(store: Store, plan: Plan): Promise<Array<{ member: MemberId; message: AgentMessage }>> {
  if (!plan.group) return [];
  const answers = await latestFromEachMember(store, plan.group);
  return answers.flatMap(({ member, lastFromMember }) => (lastFromMember ? [{ member, message: lastFromMember }] : []));
}
