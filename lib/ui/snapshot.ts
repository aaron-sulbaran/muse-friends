import type { RunBudget } from "@/lib/agent/caps";
import { paymentsFrom, type PaymentView } from "@/lib/agent/payment-rules";
import { paymentsEnabled } from "@/lib/agent/wallets";
import { modelId } from "@/lib/model";
import { CATEGORIES, isCategoryAllowed, isPaymentType, MEMBER_IDS, type AgentId, type MemberId, type PaymentProposal, type Plan, type ReelMedia, type SharePolicy, type StateSnapshot } from "@/lib/protocol";
import { displayName } from "@/lib/seed/personas";
import { CONTACTS, getContact, isMutual } from "@/lib/seed/contacts";
import { SEEDED_LABEL, TRIP_PEOPLE } from "@/lib/seed/trip";
import { describeNote, describePayment, eventLabel } from "./payments";
import { simulatedFriend } from "./tokens";
import { toolCallsOf } from "./tools";
import type { UiRecording, UiReel, Decision, FollowThroughEvent, PaymentsSettings, SharingSettings, UiBreakdownLine, UiChatMessage, UiSource, UiMessage, UiNote, UiOutcome, UiPayment, UiPlan, UiReelRead, UiRefusal, UiSnapshot, UiTrip, UiWallet } from "./types";

/*
 * The one place the Store's StateSnapshot becomes what the UI renders. When the
 * contract changes, this is the file that changes. Server-only: it reads the
 * persona display names from the seed, and the seed's calendars (with private
 * event titles) must never reach a browser bundle.
 */

export type UiOverlay = {
  mode: "live" | "replay";
  /** Replay only: which recording the frames come from (its source and the date it was made). */
  recording?: UiRecording;
  /** The run caps for the JSON drawer; omit for a recording, which spends nothing. */
  budget?: RunBudget | null;
  /** The demo reel read live from Instagram before any run has started (lib/instagram.ts). */
  liveReel?: ReelMedia | null;
};

/*
 * The people this build can draw: the two phone seats and a group plan's third friend. A store can hold rows
 * written by a newer build; drawing them would give a row with no name and no avatar, so everything that names
 * a stranger is left out instead.
 */
const KNOWN_AGENTS: ReadonlySet<string> = new Set(MEMBER_IDS);

function isKnownAgent(id: string | undefined): boolean {
  return id !== undefined && KNOWN_AGENTS.has(id);
}

/**
 * The model that plays the simulated friend: the one on the proof of her latest model-made message (so a fallback turn
 * honestly names the fallback), else the configured model before she has said anything.
 */
function modelPlayingHer(messages: UiMessage[]): string {
  const latest = messages.filter((message) => message.from === "lisa" && message.proof).sort((first, second) => first.at.localeCompare(second.at)).at(-1);
  return latest?.proof?.model ?? modelId();
}

/** The snapshot without any message, thread, redaction or timeline event that names an agent this build does not know. */
export function withoutUnknownAgents(state: StateSnapshot): StateSnapshot {
  const unknownContexts = new Set<string>();
  for (const thread of state.threads) {
    if (![thread.initiator, ...thread.participants].every(isKnownAgent)) unknownContexts.add(thread.contextId);
  }
  for (const { message } of state.messages) {
    if (!isKnownAgent(message.from) || !isKnownAgent(message.to)) unknownContexts.add(message.contextId);
  }
  const unknownRedaction = (redaction: StateSnapshot["redactions"][number]) => !isKnownAgent(redaction.from) || !isKnownAgent(redaction.to);
  const staysEvent = (event: StateSnapshot["events"][number]) =>
    (event.agent === undefined || isKnownAgent(event.agent)) && !(event.contextId !== undefined && unknownContexts.has(event.contextId));
  if (
    unknownContexts.size === 0 &&
    !state.redactions.some(unknownRedaction) &&
    state.events.every(staysEvent)
  ) {
    return state;
  }
  return {
    ...state,
    threads: state.threads.filter((thread) => !unknownContexts.has(thread.contextId)),
    messages: state.messages.filter(({ message }) => !unknownContexts.has(message.contextId)),
    redactions: state.redactions.filter((redaction) => !unknownRedaction(redaction) && !unknownContexts.has(redaction.contextId)),
    events: state.events.filter(staysEvent),
  };
}

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
    group: plan.group
      ? {
          coordinator: plan.group.coordinator,
          members: plan.group.members.map((id) => ({ id, decision: (plan.group?.decisions[id] ?? "pending") as Decision })),
          contextIds: [...new Set([plan.contextId, ...Object.values(plan.group.contexts)])],
        }
      : null,
    kind: plan.kind ?? "hangout",
    trip: toUiTrip(plan, state),
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

/** The trip a plan of kind "trip" carries, with the people named, the pot's balances read from the ledger, and every price labeled seeded. */
function toUiTrip(plan: Plan, state: StateSnapshot): UiTrip | null {
  const trip = plan.trip;
  if (plan.kind !== "trip" || !trip || !plan.group) return null;
  const ledger = state.room.localLedger ?? {};
  const balanceOf = (accountId: string | undefined) => (accountId !== undefined && ledger[accountId] !== undefined ? ledger[accountId] : null);
  return {
    title: trip.title,
    destination: trip.destination,
    horizon: trip.horizon,
    range: trip.range,
    people: plan.group.members.map((member) => ({
      member,
      name: TRIP_PEOPLE[member].name,
      muse: TRIP_PEOPLE[member].muse,
      simulated: member === "kai" || (member !== plan.group!.coordinator && state.room.simulatedFriend),
      taste: TRIP_PEOPLE[member].taste,
      constraint: TRIP_PEOPLE[member].constraint,
    })),
    answers: plan.group.members.flatMap((member) => {
      const answer = trip.answers[member];
      return answer ? [{ member, answer: answer.answer, limit: answer.limit, taste: answer.taste, constraint: answer.constraint ?? null, by: answer.by, at: answer.at }] : [];
    }),
    cap: trip.cap ?? null,
    itinerary: trip.itinerary ? { ...trip.itinerary, lines: trip.itinerary.lines.map((line) => ({ ...line })) } : null,
    pot: trip.pot
      ? {
          perPerson: trip.pot.perPerson,
          target: trip.pot.target,
          balance: balanceOf(trip.pot.potAccountId),
          breakdown: trip.pot.breakdown,
          deposits: plan.group.members.flatMap((member) => {
            const deposit = trip.pot?.deposits[member];
            return deposit ? [{ member, amount: deposit.amount, status: deposit.status, ...(deposit.withdrawalId ? { withdrawalId: deposit.withdrawalId } : {}), ...(deposit.depositId ? { depositId: deposit.depositId } : {}), ...(deposit.refundId ? { refundId: deposit.refundId } : {}), ...(deposit.by ? { by: deposit.by } : {}), ...(deposit.error ? { error: deposit.error } : {}) }] : [];
          }),
          wallets: plan.group.members.map((member) => ({ member, balance: balanceOf(trip.pot?.wallets[member]?.accountId) })),
        }
      : null,
    unknowns: trip.unknowns,
    seededLabel: SEEDED_LABEL,
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

const noteKinds = new Set<string>(["payment_proposed", "payment_cancelled", "receipt_read", "caption_extracted", "thread_opened", "policy_changed", "busy_added", "message_rejected", "payment_sent", "payment_received", "payment_declined", "payment_failed", "chat_asked", "web_searched"]);

/**
 * An inbox that refuses a message for what it carries (422) or who sent it (403) is the code saying no, which is
 * worth a row. A 409 is a sequencing hiccup (a retry, a message out of turn), which is not.
 */
function isWorthARow(event: StateSnapshot["events"][number]): boolean {
  if (event.kind !== "message_rejected") return true;
  const status = /\((\d{3})\)/.exec(event.text)?.[1];
  return status === "422" || status === "403";
}

/** One row per reel a run started from, saying honestly whether it came live from Instagram or from the seed. */
function reelSourceNotes(state: StateSnapshot): UiNote[] {
  return state.signals.map((signal) => ({
    id: `note_reel_${signal.id}`,
    kind: "reel_source" as const,
    at: signal.receivedAt,
    text:
      signal.provenance.source === "instagram_graph_api"
        ? `Lisa's own reel, read live from @${signal.media.username} through the Instagram Graph API`
        : "Seeded demo reel, fictional (Instagram was not used for this run)",
  }));
}

/**
 * A rejection as privacy proof: one plain sentence per reason, naming the Muses (the server does not know the
 * people's names). The raw technical text stays as the row's hover detail.
 */
function privacySentence(text: string, recipient: AgentId, muse: (agent: AgentId) => string): string {
  const sender: AgentId = recipient === "aaron" ? "lisa" : "aaron";
  const from = muse(sender);
  const to = muse(recipient);
  const status = /\((\d{3})\)/.exec(text)?.[1];
  const reason = /\(\d{3}\):\s*(.*)$/.exec(text)?.[1] ?? "";
  const categories = /sharing policy does not allow \(([^)]*)\)/.exec(reason)?.[1];
  if (categories) return `Blocked: ${from} tried to share ${categories} with ${to}; the sharing settings don't allow it`;
  if (/outside the sender's free blocks/.test(reason)) return `Blocked: ${from} offered a time that isn't really free; only real free times go out`;
  if (/already passed over/.test(reason)) return `Blocked: ${from} offered a time that was already turned down`;
  if (status === "403") return `Blocked: a message that didn't come from ${from} was refused`;
  return `Held back: an out-of-turn message from ${from} was stopped before it reached ${to}`;
}

function toNotes(state: StateSnapshot, rename: (text: string) => string, payments: UiPayment[], muse: (agent: AgentId) => string = displayName): UiNote[] {
  const chat = state.room.chat ?? [];
  const followUps = new Map(state.plans.filter((plan) => plan.target !== undefined).map((plan) => [plan.id, plan]));
  return state.events.flatMap((event): UiNote[] => {
    const text = rename(describeNote(event.text, payments));
    const followUp = event.planId ? followUps.get(event.planId) : undefined;
    if (followUp && event.kind === "signal_received") return [{ id: event.id, kind: "contact_chosen", at: event.at, text }];
    if (followUp && isRefused(followUp) && event.kind === "plan_state") return [{ id: event.id, kind: "contact_refused", at: event.at, text }];
    if (!noteKinds.has(event.kind) || !isWorthARow(event)) return [];
    if (event.kind === "message_rejected") {
      return [{ id: event.id, kind: "message_rejected", at: event.at, text: privacySentence(event.text, event.agent ?? "lisa", muse), detail: text }];
    }
    const base = { id: event.id, kind: event.kind as UiNote["kind"], at: event.at, text };
    if (event.kind === "web_searched") return [{ ...base, ...(event.links && event.links.length > 0 ? { links: event.links.map(toSource) } : {}) }];
    if (event.kind !== "chat_asked" || !event.messageId) return [base];
    // A "You asked" row carries the tools the Muse used, read from the proof on its answer.
    const toolCalls = toolCallsOf(chat.find((entry) => entry.id === event.messageId)?.proof);
    return [{ ...base, answerId: event.messageId, ...(toolCalls ? { toolCalls } : {}) }];
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

/** A page a search found, with the site's host for the chip ("www." dropped). The address was checked when it was stored. */
function toSource(link: { title: string; url: string }): UiSource {
  let host = link.url;
  try {
    host = new URL(link.url).hostname.replace(/^www\./, "");
  } catch {
    // keep the address itself as the label
  }
  return { title: link.title, url: link.url, host };
}

function toChat(state: StateSnapshot, rename: (text: string) => string): UiChatMessage[] {
  return (state.room.chat ?? []).map((entry) => {
    // The chips under an answer: the pages of its searches, one per address, three at most.
    const links = [...new Map((entry.searches ?? []).flatMap((search) => search.links).map((link) => [link.url, link] as const)).values()].slice(0, 3);
    return {
      id: entry.id,
      from: entry.from,
      text: rename(entry.text),
      at: entry.at,
      ...(entry.replyTo ? { replyTo: entry.replyTo } : {}),
      ...(entry.proof ? { proof: withToolCalls(entry.proof) } : {}),
      ...(links.length > 0 ? { sources: links.map(toSource) } : {}),
    };
  });
}

/** The message's proof, with its recorded tool calls tidied for display when there are any. */
function withToolCalls(proof: StateSnapshot["messages"][number]["proof"]): UiMessage["proof"] {
  if (!proof) return undefined;
  const toolCalls = toolCallsOf(proof);
  return toolCalls ? { ...proof, toolCalls } : proof;
}

function toUiMessages(state: StateSnapshot, rename: (text: string) => string): UiMessage[] {
  // Payments have a channel of their own (UiSnapshot.payments); they are not chat bubbles.
  return state.messages.filter((record) => !isPaymentType(record.message.type)).map((record) => {
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
      ...(message.trip ? { trip: message.trip } : {}),
      at: message.at,
      proof: withToolCalls(record.proof),
      blockedRule: rejected ? (record.error ?? "Rejected by the receiving inbox") : undefined,
      raw: message,
    };
  });
}

/**
 * Whose model call is running right now: for each pair thread still working, the receiver of its last message, or
 * the initiator before the first. A plan for three has two pair threads, so both friends can be thinking at once.
 */
function deriveInFlight(state: StateSnapshot, plan: Plan | null): UiSnapshot["inFlight"] {
  if (!plan) return null;
  // A trip waits on people most of the time; the coordinator is only thinking while it composes the itinerary.
  if (plan.kind === "trip") {
    const composing = plan.state === "negotiating" && plan.group?.members.every((member) => plan.trip?.answers[member]) && !plan.trip?.itinerary;
    return composing ? { agent: plan.group!.coordinator, agents: [plan.group!.coordinator] } : null;
  }
  const groupId = plan.group?.groupId;
  const threads = groupId ? state.threads.filter((candidate) => candidate.groupId === groupId) : state.threads.filter((candidate) => candidate.contextId === plan.contextId);
  if (threads.length === 0) return plan.state === "detected" ? { agent: plan.initiator, agents: [plan.initiator] } : null;
  const thinking: Array<{ agent: MemberId; at: string }> = [];
  for (const thread of threads) {
    if (thread.state !== "working") continue;
    const last = state.messages.filter((record) => record.message.contextId === thread.contextId).at(-1);
    thinking.push({ agent: last ? last.message.to : thread.initiator, at: last?.message.at ?? thread.updatedAt });
  }
  if (thinking.length === 0) return null;
  const agents = [...new Set(thinking.map((entry) => entry.agent))];
  const latest = [...thinking].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0].agent;
  return { agent: latest, agents };
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

/** A run's reel when it came live from Instagram, else the one read before the run, else null (the seeded reel). */
function reelFor(state: StateSnapshot, before: ReelMedia | null): UiReel | null {
  const media = state.signals.findLast((signal) => signal.provenance.source === "instagram_graph_api")?.media ?? before;
  if (!media) return null;
  return { username: media.username, caption: media.caption, permalink: media.permalink, thumbnailUrl: media.thumbnail_url ?? null, profilePictureUrl: media.profile_picture_url ?? null };
}

/**
 * What a phone is allowed to read. The chat with a Muse (D31) belongs to the person on side a, and the snapshot is
 * otherwise the same for both phones, so a request that says it is side b (`/api/state?role=b`) gets the snapshot
 * without any chat line and without the "You asked" rows. No role, or `a`, is the full view the stage and the gate
 * use. Anything else fails closed and gets the restricted view. If side b ever gets a chat, its lines are hidden from
 * side a the same way: the lines would carry their side and this is the one place that filters them.
 */
export const CHAT_SIDE = "a";

export function forRole(snapshot: UiSnapshot, role: string | null | undefined): UiSnapshot {
  if (role === undefined || role === null || role === CHAT_SIDE) return snapshot;
  // The "You asked" rows and the searches the chat ran (what side a asked about) go with the chat.
  return { ...snapshot, chat: [], notes: snapshot.notes.filter((note) => note.kind !== "chat_asked" && note.kind !== "web_searched") };
}

/** The latest caption read: what the model found, not the sentence the timeline says about it. */
function reelReadFor(state: StateSnapshot): UiReelRead | null {
  const extracted = state.signals.findLast((signal) => signal.extracted !== undefined)?.extracted;
  if (!extracted || (!extracted.place && !extracted.area && !extracted.hours)) return null;
  return { place: extracted.place ?? null, area: extracted.area ?? null, hours: extracted.hours ?? null };
}

export function toUiSnapshot(stored: StateSnapshot, overlay: UiOverlay): UiSnapshot {
  const state = withoutUnknownAgents(stored);
  const plan = latestPlan(state.plans);
  const standIn = standInOf(state, plan);
  const rename = renameFor(standIn);
  const messages = toUiMessages(state, rename);
  const payments = paymentsOf(state);
  return {
    now: state.clock.now,
    clockSimulated: state.events.some((event) => event.kind === "clock_advanced"),
    mode: overlay.mode,
    ...(overlay.recording ? { recording: overlay.recording } : {}),
    simulatedFriend: state.room.simulatedFriend,
    ...(state.room.simulatedFriend ? { simulatedFriendModel: modelPlayingHer(messages) } : {}),
    standIn,
    sides: { aaron: displayName("aaron"), lisa: displayName("lisa"), kai: displayName("kai") },
    messages,
    notes: [...reelSourceNotes(state), ...toNotes(state, rename, payments, (agent) => (agent === "lisa" && standIn ? standIn.muse : displayName(agent)))].sort((first, second) => first.at.localeCompare(second.at)),
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
    reel: reelFor(state, overlay.liveReel ?? null),
    reelRead: reelReadFor(state),
    failure: failureOf(state, plan),
    sharing: { aaron: sharingFor("aaron", state), lisa: sharingFor("lisa", state) },
    wallets: { aaron: walletFor("aaron", state, rename), lisa: walletFor("lisa", state, rename) },
    payments,
    chat: toChat(state, rename),
    paymentsScope: { aaron: paymentsScopeFor("aaron", state), lisa: paymentsScopeFor("lisa", state) },
    sandbox: sandboxFor(state),
  };
}

// The wallet is named for the person at that seat, as the rest of the screen says it ("Michelle's wallet" when the
// simulated friend plays side b); the Nessie record keeps the seed's nickname.
function walletFor(owner: AgentId, state: StateSnapshot, rename: (text: string) => string): UiWallet | null {
  const wallet = state.room.wallets?.[owner];
  return wallet ? { balance: wallet.balance, nickname: rename(wallet.nickname), source: wallet.source, accountId: wallet.accountId } : null;
}

function paymentsScopeFor(owner: AgentId, state: StateSnapshot): PaymentsSettings {
  const scope = state.policies.find((candidate) => candidate.owner === owner)?.payments;
  return { enabled: Boolean(scope?.enabled && scope.capPerPlan > 0), cap: scope?.capPerPlan ?? 0 };
}

function sandboxFor(state: StateSnapshot): UiSnapshot["sandbox"] {
  const wallets = Object.values(state.room.wallets ?? {});
  const connected = wallets.length > 0 && wallets.every((wallet) => wallet.source === "nessie");
  const enabled = paymentsEnabled();
  return {
    enabled,
    connected,
    text: !enabled ? "Payments are switched off" : connected ? "Capital One Nessie sandbox, balances kept by Muse" : "Sandbox not connected, local ledger",
    // Only true of the real sandbox: its transactions are real records, but the balance field on its accounts never follows them.
    ...(enabled && connected ? { balanceNote: "The sandbox records each payment but never changes an account's own balance, so Muse keeps the balances shown here." } : {}),
  };
}

/** The plan a payment belongs to, as far as naming it goes: its title and window. */
function planNamed(planId: string, state: StateSnapshot): Pick<UiPlan, "activityTitle" | "window"> | null {
  const plan = state.plans.find((candidate) => candidate.id === planId);
  return plan ? { activityTitle: plan.activity?.title ?? "the plan", window: plan.window ?? null } : null;
}

const dollars = (amount: number) => (amount < 0 ? `-$${-amount}` : `$${amount}`);

// "Why $16?" from the same lines the card shows: each line with its amount, then the total.
function explain(proposal: PaymentProposal): string {
  return `${proposal.breakdown.map((line) => `${line.label}: ${dollars(line.amount)}`).join(". ")}. You send ${dollars(proposal.amount)}.`;
}

function breakdownLines(proposal: PaymentProposal): UiBreakdownLine[] {
  const calls = proposal.calls ?? [];
  return proposal.breakdown.map((line) => ({
    label: line.label,
    amount: line.amount,
    source: line.source,
    sourceKind: line.source === "estimate" ? "estimate" : line.source === "note" ? "note" : "tool",
    ...(calls.find((call) => call.callId === line.source) ? { tool: calls.find((call) => call.callId === line.source)!.name } : {}),
  }));
}

// A proposal that has not become a payment message yet. confirming is mid-send, so it reads as sent.
function fromProposal(proposal: PaymentProposal): UiPayment {
  const open = proposal.status === "proposed" || proposal.status === "failed";
  const status: UiPayment["status"] = proposal.status === "confirming" || proposal.status === "confirmed" ? "sent" : proposal.status;
  const toolCalls = toolCallsOf(proposal.proof);
  return {
    id: proposal.paymentId,
    planId: proposal.planId,
    from: proposal.payer,
    to: proposal.payee,
    amount: proposal.amount,
    reason: proposal.reason,
    ...(proposal.note ? { note: proposal.note } : {}),
    status,
    source: proposal.source,
    breakdown: breakdownLines(proposal),
    explanation: explain(proposal),
    ...(proposal.receipt ? { receipt: { seeded: true as const, place: proposal.receipt.place, total: proposal.receipt.total } } : {}),
    ...(open ? { confirmUrl: `/api/payments/${proposal.paymentId}/confirm`, declineUrl: `/api/payments/${proposal.paymentId}/decline` } : {}),
    ...(proposal.error ? { error: proposal.error } : {}),
    ...(toolCalls ? { toolCalls } : {}),
    at: proposal.proposedAt,
  };
}

function toUiPayment(view: PaymentView, proposal?: PaymentProposal): UiPayment {
  const base: UiPayment = {
    id: view.paymentId,
    planId: view.planId,
    from: view.payer,
    to: view.payee,
    amount: view.amount,
    reason: view.reason,
    ...(view.note ? { note: view.note } : {}),
    status: view.status,
    source: view.source,
    ...(view.withdrawalId ? { withdrawalId: view.withdrawalId } : {}),
    ...(view.depositId ? { depositId: view.depositId } : {}),
    ...(view.balanceBefore !== undefined ? { balanceBefore: view.balanceBefore } : {}),
    ...(view.balanceAfter !== undefined ? { balanceAfter: view.balanceAfter } : {}),
    ...(toolCallsOf({ toolCalls: view.toolCalls }) ? { toolCalls: toolCallsOf({ toolCalls: view.toolCalls }) } : {}),
    at: view.at,
  };
  if (!proposal) return base;
  return {
    ...base,
    breakdown: breakdownLines(proposal),
    explanation: explain(proposal),
    ...(proposal.receipt ? { receipt: { seeded: true as const, place: proposal.receipt.place, total: proposal.receipt.total } } : {}),
    ...(base.toolCalls ? {} : toolCallsOf(proposal.proof) ? { toolCalls: toolCallsOf(proposal.proof) } : {}),
    at: proposal.proposedAt,
  };
}

// Every payment in the room, oldest first: the proposals (waiting, declined, failed) and the payments they became.
function paymentsOf(state: StateSnapshot): UiPayment[] {
  const proposals = state.room.proposals ?? {};
  const sent = paymentsFrom(state.messages);
  const byId = new Map<string, UiPayment>();
  for (const proposal of Object.values(proposals)) byId.set(proposal.paymentId, fromProposal(proposal));
  for (const view of sent) byId.set(view.paymentId, toUiPayment(view, proposals[view.paymentId]));
  return [...byId.values()].sort((a, b) => a.at.localeCompare(b.at)).map((payment) => named(payment, planNamed(payment.planId, state)));
}

/** A payment with the plan's event and day in front of its reason, for the cards and the Activity row. */
function named(payment: UiPayment, plan: Pick<UiPlan, "activityTitle" | "window"> | null): UiPayment {
  return { ...payment, description: describePayment(payment.reason, plan), ...(plan ? { planLabel: eventLabel(plan) } : {}) };
}
