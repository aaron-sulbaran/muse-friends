import { MAX_WINDOW_HOURS, THREAD_CAP, type ActivityEvent, type AgentMessage, type MemberId, type Plan, type PlanGroup, type SendToFriendArgs, type Signal, type Window } from "@/lib/protocol";
import { displayName } from "@/lib/seed/fixtures";
import type { AgentRuntimeContext } from "./context";
import { ownFreeBlocks } from "./calendar";
import { memberContexts, planForContext } from "./group";
import { newId, otherAgent, seatOf } from "./ids";
import { sendToFriend } from "./outbox";
import { describeWindow, intersectWindows, isSubsetOfBlocks, toCentralIso, toMs, windowHash } from "./windows";

// The scripted fallback turn. When the model cannot produce a message (the API errored past its retries, or
// the nudge got no tool call), the agent still answers, in code: a protocol-valid message built from its own
// verified free windows and sent through the same send path as the model's tool call, so the same checks run
// (turn taking, the cap, windows inside free blocks, the rejected-window ledger, the share policy, the schema).
// It carries no model proof, and the timeline says it was a fallback. Nothing here invents a fact: windows
// come from the calendar, the place from the caption, and the wording is fixed.

const HOUR_MS = 3_600_000;
const EVENING = { from: 17, to: 22 };
const MAX_OFFERED = 3;
const MIN_WINDOW_MS = HOUR_MS;

export type FallbackOutcome = { sent: true } | { sent: false; reason: "no_windows" | "send_failed"; error?: string };

function capLength(window: Window): Window {
  const end = Math.min(toMs(window.end), toMs(window.start) + MAX_WINDOW_HOURS * HOUR_MS);
  return { start: window.start, end: toCentralIso(end) };
}

// Up to three windows, earliest first, one per day: the evening part of each free block when there is one
// (a meal or a hang is an evening plan), otherwise any free stretch of an hour or more.
export function fallbackWindows(free: Window[], skip: Set<string> = new Set()): Window[] {
  const evenings: Window[] = [];
  for (const block of free) {
    let day = Date.parse(`${block.start.slice(0, 10)}T00:00:00-05:00`);
    while (day < toMs(block.end)) {
      const evening = { start: toCentralIso(day + EVENING.from * HOUR_MS), end: toCentralIso(day + EVENING.to * HOUR_MS) };
      evenings.push(...intersectWindows([block], [evening]).map(capLength));
      day += 24 * HOUR_MS;
    }
  }
  const anytime = free.filter((block) => toMs(block.end) - toMs(block.start) >= MIN_WINDOW_MS).map(capLength);
  const picked: Window[] = [];
  const days = new Set<string>();
  for (const window of [...evenings, ...anytime]) {
    const day = window.start.slice(0, 10);
    if (skip.has(windowHash(window)) || days.has(day) || toMs(window.end) - toMs(window.start) < MIN_WINDOW_MS) continue;
    days.add(day);
    picked.push(window);
    if (picked.length === MAX_OFFERED) break;
  }
  return picked.sort((a, b) => toMs(a.start) - toMs(b.start));
}

const TITLE_MAX = 60;

// What the plan is about, read from the caption without a model: "at Shawarma Point on E 6th St" gives the
// title and the area. A caption that does not read that way gives a plain "this spot" rather than a guess.
export function activityFromSignal(signal: Signal | null): { kind: "food"; title: string; place?: string } {
  if (signal?.extracted?.place) return { kind: "food", title: signal.extracted.place.slice(0, TITLE_MAX), ...(signal.extracted.area ? { place: signal.extracted.area.slice(0, 60) } : {}) };
  const caption = signal?.media.caption ?? "";
  const name = /\b(?:at|from|@)\s+((?:[A-Z][\w'&.-]*\s?){1,4})/.exec(caption)?.[1]?.trim();
  const area = /\bon\s+((?:[A-Z0-9][\w.'-]*\s?){1,4})/.exec(caption)?.[1]?.trim();
  return { kind: "food", title: (name ?? "this spot").slice(0, TITLE_MAX), ...(area ? { place: area.slice(0, 60) } : {}) };
}

// `friend` is the other phone seat unless the turn names one (a coordinator answering each member of a group).
async function send(ctx: AgentRuntimeContext, args: Omit<SendToFriendArgs, "friend">, summary: string, friend: MemberId = otherAgent(ctx.agent)): Promise<FallbackOutcome> {
  const result = await sendToFriend(ctx, { friend, ...args });
  if ("error" in result) return { sent: false, reason: "send_failed", error: result.error };
  const nowMs = ctx.wallNow?.() ?? Date.now();
  const contextId = ctx.contexts?.[friend] ?? ctx.contextId;
  const plan = await planForContext(ctx.store, contextId);
  const sent = (await ctx.store.listMessages(contextId)).map((record) => record.message).filter((message) => message.from === ctx.agent).at(-1);
  const event: ActivityEvent = {
    id: newId("evt", nowMs),
    at: toCentralIso(nowMs),
    kind: "plan_state",
    actor: "agent",
    agent: seatOf(ctx.agent),
    contextId,
    planId: plan?.id,
    messageId: sent?.id,
    text: `Fallback: the model could not reply, so ${displayName(ctx.agent)} sent ${summary}`.slice(0, 240),
  };
  await ctx.store.appendEvent(event);
  return { sent: true };
}

// The initiator could not open the conversation: offer its own free windows for the reel's place.
export async function fallbackOpening(ctx: AgentRuntimeContext): Promise<FallbackOutcome> {
  const free = await ownFreeBlocks(ctx.store, ctx.agent);
  const windows = fallbackWindows(free);
  if (windows.length === 0) return { sent: false, reason: "no_windows" };
  const signal = ctx.signalId ? await ctx.store.getSignal(ctx.signalId) : null;
  return send(
    ctx,
    { type: "intent", reason: "interest_match", activity: activityFromSignal(signal), windows, note: "Want to go? Here are times I am free.", share: ["food"] },
    "its free windows",
  );
}

function byLength(a: Window, b: Window): number {
  return toMs(b.end) - toMs(b.start) - (toMs(a.end) - toMs(a.start)) || toMs(a.start) - toMs(b.start);
}

// The longest window of a list (the earliest of equals): a plan needs room more than it needs a day.
function longestOf(windows: Window[]): Window | undefined {
  return [...windows].sort(byLength)[0];
}

// The receiving agent could not reply: close on a window that works for both when there is one, otherwise
// offer its own free windows, and decline when it has nothing left to offer or this is the closing message.
// A member of a group plan never closes first: the coordinator needs every member's windows before it picks
// one, so it answers its intent with a counter of every window that works, and accepts only what the
// coordinator then accepts.
export async function fallbackReply(
  ctx: AgentRuntimeContext,
  input: { thread: AgentMessage[]; mutualWindows: Window[]; ledger: Set<string>; group?: boolean },
): Promise<FallbackOutcome> {
  const { thread, mutualWindows, ledger } = input;
  const friendLast = [...thread].reverse().find((message) => message.from !== ctx.agent);
  const seq = thread.length + 1;
  const free = await ownFreeBlocks(ctx.store, ctx.agent);

  if (input.group && friendLast?.type !== "accept" && mutualWindows.length > 0) {
    const worked = [...mutualWindows].sort(byLength).slice(0, MAX_OFFERED).sort((a, b) => toMs(a.start) - toMs(b.start));
    return send(ctx, { type: "counter", reason: "both_free", windows: worked, note: "Those times work for me." }, "the windows that work for it");
  }

  const accepted = friendLast?.type === "accept" ? friendLast.windows?.[0] : undefined;
  const closeOn = accepted && isSubsetOfBlocks(accepted, free) ? accepted : input.group ? undefined : longestOf(mutualWindows);
  if (closeOn) {
    return send(ctx, { type: "accept", reason: "both_free", windows: [closeOn], note: "That works for me." }, `an accept of ${describeWindow(closeOn)}`);
  }

  const own = fallbackWindows(free, ledger);
  if (seq < THREAD_CAP && own.length > 0) {
    return send(ctx, { type: "counter", reason: "no_overlap", windows: own, note: "Those do not fit me, here are times I am free." }, "its free windows");
  }
  return send(ctx, { type: "decline", reason: "no_overlap", note: "I cannot find a time that works." }, "a decline, no shared free time");
}

// The coordinator of a group could not open it: the same intent to every member that has not heard from it yet,
// each on its own pair thread. A member that already got a message from the model keeps it.
export async function fallbackGroupOpening(ctx: AgentRuntimeContext, group: PlanGroup): Promise<FallbackOutcome> {
  const free = await ownFreeBlocks(ctx.store, ctx.agent);
  const windows = fallbackWindows(free);
  if (windows.length === 0) return { sent: false, reason: "no_windows" };
  const signal = ctx.signalId ? await ctx.store.getSignal(ctx.signalId) : null;
  for (const { member, contextId } of memberContexts(group)) {
    const prior = await ctx.store.listMessages(contextId);
    if (prior.some((record) => record.message.from === ctx.agent)) continue;
    const outcome = await send(
      ctx,
      { type: "intent", reason: "interest_match", activity: activityFromSignal(signal), windows, note: "Want to go? Here are times I am free.", share: ["food"] },
      "its free windows",
      member,
    );
    if (!outcome.sent) return outcome;
  }
  return { sent: true };
}

// The coordinator could not finish round 2: accept the longest window that works for everyone with each member
// that has not been answered yet, or decline them all when no window works for all three.
export async function fallbackGroupConfirm(ctx: AgentRuntimeContext, plan: Plan, candidates: Window[]): Promise<FallbackOutcome> {
  const best = longestOf(candidates);
  for (const { member, contextId } of memberContexts(plan.group!)) {
    const prior = await ctx.store.listMessages(contextId);
    if (prior.at(-1)?.message.from === ctx.agent) continue;
    const outcome = best
      ? await send(ctx, { type: "accept", reason: "both_free", windows: [best], note: "That works for me." }, `an accept of ${describeWindow(best)} for all three`, member)
      : await send(ctx, { type: "decline", reason: "no_overlap", note: "I cannot find a time that works for all three." }, "a decline, no time works for all three", member);
    if (!outcome.sent) return outcome;
  }
  return { sent: true };
}
