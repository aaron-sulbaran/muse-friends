import type { RunBudget } from "@/lib/agent/caps";
import { paymentsFrom, type PaymentView } from "@/lib/agent/payment-rules";
import { paymentsEnabled } from "@/lib/agent/wallets";
import { AGENT_IDS, CATEGORIES, isCategoryAllowed, isPaymentType, type AgentId, type PaymentProposal, type Plan, type ReelMedia, type SharePolicy, type StateSnapshot } from "@/lib/protocol";
import { displayName } from "@/lib/seed/personas";
import { describeNote, describePayment, eventLabel } from "./payments";
import { simulatedFriend } from "./tokens";
import { toolCallsOf } from "./tools";
import type { UiRecording, UiReel, Decision, FollowThroughEvent, PaymentsSettings, SharingSettings, UiBreakdownLine, UiMessage, UiNote, UiOutcome, UiPayment, UiPlan, UiSnapshot, UiWallet } from "./types";

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
 * The people this build can draw. A store can hold rows written by a newer build (a group plan's third friend,
 * left in a shared room by a branch run); drawing them would give a row with no name and no avatar, so
 * everything that names a stranger is left out instead.
 */
const KNOWN_AGENTS: ReadonlySet<string> = new Set(AGENT_IDS);

function isKnownAgent(id: string | undefined): boolean {
  return id !== undefined && KNOWN_AGENTS.has(id);
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

/**
 * With a simulated friend, side b's person is Michelle, but the agents and the fixtures write text with
 * the persona name. People see Michelle in every sentence about her; the raw JSON in the drawer stays as sent.
 */
function renameFor(state: StateSnapshot): (text: string) => string {
  if (!state.room.simulatedFriend) return (text) => text;
  const persona = displayName("lisa");
  const pattern = new RegExp(`\\b${persona}\\b`, "g");
  return (text) => text.replace(pattern, simulatedFriend.human);
}

function latestPlan(plans: Plan[]): Plan | null {
  return plans.at(-1) ?? null;
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

function toUiPlan(plan: Plan, state: StateSnapshot): UiPlan {
  const rename = renameFor(state);
  return {
    id: plan.id,
    contextId: plan.contextId,
    initiator: plan.initiator,
    state: plan.state,
    activityTitle: plan.activity?.title ?? "the plan",
    place: placeFor(plan, state),
    placeWithheld: placeWithheld(plan, state),
    window: plan.window ?? null,
    decisions: {
      a: (plan.decisions.aaron ?? "pending") as Decision,
      b: (plan.decisions.lisa ?? "pending") as Decision,
    },
    draft: plan.draft ? rename(plan.draft) : null,
    droppedReason: plan.state === "dropped" ? dropReasonText(plan.dropReason, failureOf(state, plan) !== null) : null,
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

const noteKinds = new Set<UiNote["kind"]>(["payment_proposed", "payment_cancelled", "receipt_read", "caption_extracted", "thread_opened", "policy_changed", "busy_added", "message_rejected", "payment_sent", "payment_received", "payment_declined", "payment_failed"]);

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

function toNotes(events: StateSnapshot["events"], rename: (text: string) => string, payments: UiPayment[]): UiNote[] {
  return events
    .filter((event): event is typeof event & { kind: UiNote["kind"] } => noteKinds.has(event.kind as UiNote["kind"]) && isWorthARow(event))
    .map((event) => ({ id: event.id, kind: event.kind, at: event.at, text: rename(describeNote(event.text, payments)) }));
}

/** The message's proof, with its recorded tool calls tidied for display when there are any. */
function withToolCalls(proof: StateSnapshot["messages"][number]["proof"]): UiMessage["proof"] {
  if (!proof) return undefined;
  const toolCalls = toolCallsOf(proof);
  return toolCalls ? { ...proof, toolCalls } : proof;
}

function toUiMessages(state: StateSnapshot): UiMessage[] {
  const rename = renameFor(state);
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
      at: message.at,
      proof: withToolCalls(record.proof),
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

/** A run's reel when it came live from Instagram, else the one read before the run, else null (the seeded reel). */
function reelFor(state: StateSnapshot, before: ReelMedia | null): UiReel | null {
  const media = state.signals.findLast((signal) => signal.provenance.source === "instagram_graph_api")?.media ?? before;
  if (!media) return null;
  return { username: media.username, caption: media.caption, permalink: media.permalink, thumbnailUrl: media.thumbnail_url ?? null };
}

export function toUiSnapshot(stored: StateSnapshot, overlay: UiOverlay): UiSnapshot {
  const state = withoutUnknownAgents(stored);
  const plan = latestPlan(state.plans);
  const messages = toUiMessages(state);
  const payments = paymentsOf(state);
  return {
    now: state.clock.now,
    clockSimulated: state.events.some((event) => event.kind === "clock_advanced"),
    mode: overlay.mode,
    ...(overlay.recording ? { recording: overlay.recording } : {}),
    simulatedFriend: state.room.simulatedFriend,
    sides: { aaron: displayName("aaron"), lisa: displayName("lisa") },
    messages,
    notes: [...reelSourceNotes(state), ...toNotes(state.events, renameFor(state), payments)].sort((first, second) => first.at.localeCompare(second.at)),
    plan: plan ? toUiPlan(plan, state) : null,
    followThrough: {
      events: toFollowThrough(state.events, renameFor(state)),
      agentMessageCount: messages.length,
      humanTapCount: state.events.filter((event) => event.actor === "human" && humanTapKinds.has(event.kind)).length,
    },
    inFlight: deriveInFlight(state, plan),
    budget: overlay.budget ?? null,
    reel: reelFor(state, overlay.liveReel ?? null),
    failure: failureOf(state, plan),
    sharing: { aaron: sharingFor("aaron", state), lisa: sharingFor("lisa", state) },
    wallets: { aaron: walletFor("aaron", state), lisa: walletFor("lisa", state) },
    payments,
    paymentsScope: { aaron: paymentsScopeFor("aaron", state), lisa: paymentsScopeFor("lisa", state) },
    sandbox: sandboxFor(state),
  };
}

// The wallet is named for the person at that seat, as the rest of the screen says it ("Michelle's wallet" when the
// simulated friend plays side b); the Nessie record keeps the seed's nickname.
function walletFor(owner: AgentId, state: StateSnapshot): UiWallet | null {
  const wallet = state.room.wallets?.[owner];
  return wallet ? { balance: wallet.balance, nickname: renameFor(state)(wallet.nickname), source: wallet.source, accountId: wallet.accountId } : null;
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
  return `${proposal.breakdown.map((line) => `${line.label}: ${dollars(line.amount)}`).join(". ")}. Together ${dollars(proposal.amount)}.`;
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
