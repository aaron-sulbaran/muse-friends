import type { RunBudget } from "@/lib/agent/caps";
import { CATEGORIES, isCategoryAllowed, type AgentId, type Plan, type SharePolicy, type StateSnapshot } from "@/lib/protocol";
import { displayName } from "@/lib/seed/personas";
import { CONTACTS, getContact, isMutual } from "@/lib/seed/contacts";
import { simulatedFriend } from "./tokens";
import type { Decision, FollowThroughEvent, SharingSettings, UiMessage, UiNote, UiOutcome, UiPlan, UiRefusal, UiSnapshot } from "./types";

/*
 * The one place the Store's StateSnapshot becomes what the UI renders. When the
 * contract changes, this is the file that changes. Server-only: it reads the
 * persona display names from the seed, and the seed's calendars (with private
 * event titles) must never reach a browser bundle.
 */

export type UiOverlay = {
  mode: "live" | "replay";
  /** The run caps for the JSON drawer; omit for a recording, which spends nothing. */
  budget?: RunBudget | null;
};

/** Taps and sends that move a plan along. Not the outcome, so never counted. */
const humanTapKinds = new Set(["human_decision", "handoff_opened"]);

function latestPlan(plans: Plan[]): Plan | null {
  return plans.at(-1) ?? null;
}

/** A follow-up the start gate refused: a dropped plan that names a contact, with nothing started. */
function isRefused(plan: Plan): boolean {
  return plan.state === "dropped" && plan.dropReason === "policy_blocked" && plan.target !== undefined;
}

/**
 * Who side b's person is when it is not the Muse's own persona. A plan that names a contact is with that
 * contact (their Muse is still the seeded agent on screen); otherwise a room with a simulated friend is with
 * Michelle. The contact wins, because it is the more specific fact.
 */
function standInOf(state: StateSnapshot, plan: Plan | null): UiSnapshot["standIn"] {
  // A refused follow-up never had a counterpart: nothing started, so side b keeps its own identity.
  if (plan?.target !== undefined && !isRefused(plan)) {
    const name = getContact(plan.target)?.displayName ?? plan.target;
    return { person: name, muse: `${name}'s Muse` };
  }
  if (state.room.simulatedFriend) return { person: simulatedFriend.human, muse: simulatedFriend.muse };
  return null;
}

/**
 * The agents and fixtures write text with the persona name. When side b's person is someone else (Michelle, or
 * the contact), people see that name in every sentence about them; the raw JSON in the drawer stays as sent.
 */
function renameFor(standIn: UiSnapshot["standIn"]): (text: string) => string {
  if (!standIn) return (text) => text;
  const pattern = new RegExp(`\\b${displayName("lisa")}\\b`, "g");
  return (text) => text.replace(pattern, standIn.person);
}

function placeWithheld(plan: Plan, state: StateSnapshot): boolean {
  return state.redactions.some((redaction) => redaction.contextId === plan.contextId && redaction.removed.includes("location"));
}

/**
 * The most specific place the plan has, in order: the caption model's area, the plan's own place, a
 * message's place. A place that only repeats the title adds nothing, so it is dropped.
 */
function placeFor(plan: Plan, state: StateSnapshot): string | null {
  if (placeWithheld(plan, state)) return null;
  const thread = state.threads.find((candidate) => candidate.contextId === plan.contextId);
  const signal = state.signals.find((candidate) => candidate.id === thread?.signalId) ?? state.signals.find((candidate) => candidate.extracted);
  const title = plan.activity?.title;
  const candidates = [
    signal?.extracted?.area,
    plan.activity?.place,
    ...state.messages.filter((record) => record.message.contextId === plan.contextId).map((record) => record.message.activity?.place),
  ];
  return candidates.find((candidate): candidate is string => Boolean(candidate) && candidate !== title) ?? null;
}

function toUiPlan(plan: Plan, state: StateSnapshot, rename: (text: string) => string): UiPlan {
  const refused = isRefused(plan);
  const target = plan.target !== undefined ? { id: plan.target, name: getContact(plan.target)?.displayName ?? plan.target } : null;
  return {
    id: plan.id,
    contextId: plan.contextId,
    initiator: plan.initiator,
    state: plan.state,
    activityTitle: plan.activity?.title ?? "the plan",
    place: placeFor(plan, state),
    placeWithheld: placeWithheld(plan, state),
    target,
    refused,
    window: plan.window ?? null,
    decisions: {
      a: (plan.decisions.aaron ?? "pending") as Decision,
      b: (plan.decisions.lisa ?? "pending") as Decision,
    },
    draft: plan.draft ? rename(plan.draft) : null,
    droppedReason: refused
      ? `${displayName("aaron")} only reaches out to people who follow each other`
      : plan.state === "dropped"
        ? dropReasonText(plan.dropReason, failureOf(state, plan) !== null)
        : null,
    history: plan.history.map(({ state, at }) => ({ state, at })),
    outcome: outcomeFor(plan, state),
  };
}

/** The first answer wins. A followed_through event means went (recordings have it without the route); evt_outcome_didnt_ means didnt. */
function outcomeFor(plan: Plan, state: StateSnapshot): UiOutcome | null {
  const own = state.events.filter((event) => event.planId === plan.id);
  const went = own.find((event) => event.kind === "followed_through");
  const didnt = own.find((event) => event.kind === "human_decision" && event.id.startsWith("evt_outcome_didnt_"));
  const answer = went && didnt ? (went.at <= didnt.at ? went : didnt) : (went ?? didnt);
  if (!answer) return null;
  const result = answer === went ? "went" : "didnt";
  const next = own.map((event) => /^evt_next_(.+)_(model|rule)_[a-z0-9]+$/.exec(event.id)).find((match) => match !== null) ?? null;
  return {
    result,
    at: answer.at,
    nextIdeaId: result === "went" && next ? next[1] : null,
    chosenBy: result === "went" && next ? (next[2] as "model" | "rule") : null,
  };
}

function dropReasonText(reason: Plan["dropReason"], turnFailed: boolean): string {
  if (reason === "agent_unavailable") return "An agent couldn't reply (model error)";
  if (turnFailed) return "A model call failed";
  switch (reason) {
    case "cap_reached":
      return "No agreement in 6 messages";
    case "declined":
      return "A person said not now";
    case "no_overlap":
      return "No shared free time";
    case "policy_blocked":
      return "Privacy policy blocked the message";
    case "failed":
      return "A model call failed";
    default:
      return "The plan ended";
  }
}

const noteKinds = new Set<string>(["caption_extracted", "thread_opened", "policy_changed", "busy_added"]);

function toNotes(state: StateSnapshot, rename: (text: string) => string): UiNote[] {
  const followUps = new Map(state.plans.filter((plan) => plan.target !== undefined).map((plan) => [plan.id, plan]));
  return state.events.flatMap((event): UiNote[] => {
    const text = rename(event.text);
    const followUp = event.planId ? followUps.get(event.planId) : undefined;
    if (followUp && event.kind === "signal_received") return [{ id: event.id, kind: "contact_chosen", at: event.at, text }];
    if (followUp && isRefused(followUp) && event.kind === "plan_state") return [{ id: event.id, kind: "contact_refused", at: event.at, text }];
    if (noteKinds.has(event.kind)) return [{ id: event.id, kind: event.kind as UiNote["kind"], at: event.at, text }];
    return [];
  });
}

/** The latest plan, when it is a refused follow-up: a plan that starts afterwards supersedes it on the phone. */
function refusalOf(state: StateSnapshot, plan: Plan | null, rename: (text: string) => string): UiRefusal | null {
  if (!plan || !isRefused(plan) || plan.target === undefined) return null;
  const shown = state.events.filter((event) => event.kind === "plan_state" && event.planId === plan.id).at(-1);
  return {
    id: plan.id,
    at: plan.history.at(-1)?.at ?? plan.updatedAt,
    contactName: getContact(plan.target)?.displayName ?? plan.target,
    text: shown ? rename(shown.text) : "Nothing was started",
  };
}

function toUiMessages(state: StateSnapshot, rename: (text: string) => string): UiMessage[] {
  return state.messages.map((record) => {
    const { message } = record;
    const rejected = record.delivery !== "delivered";
    return {
      id: message.id,
      contextId: message.contextId,
      seq: message.seq,
      from: message.from,
      to: message.to,
      type: message.type,
      state: message.state,
      activity: message.activity ? { title: message.activity.title, place: message.activity.place } : undefined,
      windows: message.windows,
      reason: message.reason,
      note: message.note ? rename(message.note) : undefined,
      shared: record.stamp.passed,
      removed: record.stamp.removed,
      at: message.at,
      proof: record.proof,
      blockedRule: rejected ? (record.error ?? "Rejected by the receiving inbox") : undefined,
      raw: message,
    };
  });
}

/** Whose model call is running right now, derived from the thread: the receiver of the last message, or the initiator before the first. */
function deriveInFlight(state: StateSnapshot, plan: Plan | null): UiSnapshot["inFlight"] {
  if (!plan) return null;
  const thread = state.threads.find((candidate) => candidate.contextId === plan.contextId);
  if (!thread) return plan.state === "detected" ? { agent: plan.initiator } : null;
  if (thread.state !== "working") return null;
  const last = state.messages.filter((record) => record.message.contextId === thread.contextId).at(-1);
  return { agent: last ? last.message.to : thread.initiator };
}

/** An agent's turn that produced no message ends the thread as failed and leaves a turn_failed event naming the agent. */
function failureOf(state: StateSnapshot, plan: Plan | null): UiSnapshot["failure"] {
  if (!plan) return null;
  const thread = state.threads.find((candidate) => candidate.contextId === plan.contextId);
  if (thread?.state !== "failed") return null;
  const failed = state.events.filter((event) => event.kind === "turn_failed" && event.contextId === plan.contextId).at(-1);
  return failed?.agent ? { agent: failed.agent } : null;
}

function sharingFor(owner: AgentId, state: StateSnapshot): SharingSettings {
  const policy: SharePolicy | undefined = state.policies.find((candidate) => candidate.owner === owner);
  const categories = Object.fromEntries(CATEGORIES.map((category) => [category, isCategoryAllowed(policy, category)])) as Record<
    (typeof CATEGORIES)[number],
    boolean
  >;
  return { tier: policy?.tier ?? "off", categories };
}

/** The counter counts one thing: plans that happened. Lane A marks that moment with a followed_through event. */
function toFollowThrough(events: StateSnapshot["events"], rename: (text: string) => string): FollowThroughEvent[] {
  return events.filter((event) => event.kind === "followed_through").map((event) => ({ id: event.id, label: rename(event.text), at: event.at }));
}

export function toUiSnapshot(state: StateSnapshot, overlay: UiOverlay): UiSnapshot {
  const plan = latestPlan(state.plans);
  const standIn = standInOf(state, plan);
  const rename = renameFor(standIn);
  const messages = toUiMessages(state, rename);
  return {
    now: state.clock.now,
    clockSimulated: state.events.some((event) => event.kind === "clock_advanced"),
    mode: overlay.mode,
    simulatedFriend: state.room.simulatedFriend,
    standIn,
    sides: { aaron: displayName("aaron"), lisa: displayName("lisa") },
    messages,
    notes: toNotes(state, rename),
    contacts: CONTACTS.map((contact) => ({
      id: contact.id,
      name: contact.displayName,
      tier: contact.tier,
      youFollow: contact.youFollow,
      followsYou: contact.followsYou,
      mutualFollow: isMutual(contact),
      note: contact.howYouMet,
    })),
    refusal: refusalOf(state, plan, rename),
    plan: plan ? toUiPlan(plan, state, rename) : null,
    followThrough: {
      events: toFollowThrough(state.events, rename),
      agentMessageCount: messages.length,
      humanTapCount: state.events.filter((event) => event.actor === "human" && humanTapKinds.has(event.kind)).length,
    },
    inFlight: deriveInFlight(state, plan),
    budget: overlay.budget ?? null,
    failure: failureOf(state, plan),
    sharing: { aaron: sharingFor("aaron", state), lisa: sharingFor("lisa", state) },
  };
}
