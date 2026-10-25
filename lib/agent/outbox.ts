import { z } from "zod";
import {
  AgentMessage,
  SendToFriendArgs,
  MAX_WINDOW_HOURS,
  THREAD_CAP,
  type MemberId,
  type MessageRecord,
  type Window,
} from "@/lib/protocol";
import { enforceSharePolicy, projectShared, startGate } from "@/lib/policy";
import { getContact } from "@/lib/seed/contacts";
import { getPersona } from "@/lib/seed/fixtures";
import type { ToolMeta } from "@/lib/model";
import type { AgentRuntimeContext } from "./context";
import { ownFreeBlocks } from "./calendar";
import { commitMessage } from "./inbound";
import { describeCandidates, groupCandidates, planForContext } from "./group";
import { newId, otherAgent } from "./ids";
import { closesThread, isForcedClose, nextThreadState } from "./thread";
import { summarizeToolCall } from "@/lib/tool-summary";
import { describeWindow, isSubsetOfBlocks, toCentralIso, toMs, windowHash } from "./windows";

// send_to_friend_agent. Every check here is code, not prompt: the thread cap and turn taking, windows
// that must come from the sender's own free blocks (one re-prompt, then dropped), the rejected-window
// ledger, the share policy, and a final schema parse. Errors go back to the model as tool output.

export type SendResult =
  | { ok: true; seq: number; state: string; delivered: true }
  | { error: string };

const ENDED = new Set(["rejected", "failed", "completed", "input-required"]);

function fail(error: string): SendResult {
  return { error };
}

// Who this turn may message: the other phone seat, or the members a group turn names.
function counterpartsOf(ctx: AgentRuntimeContext): MemberId[] {
  return ctx.counterparts ?? [otherAgent(ctx.agent)];
}

// Models sometimes write a friend's display name instead of the id, or leave it out. Read either as the friend
// it names; with a single possible friend, a missing one is that friend.
function normalizeArgs(ctx: AgentRuntimeContext, rawArgs: unknown): unknown {
  if (typeof rawArgs !== "object" || rawArgs === null) return rawArgs;
  const candidates = counterpartsOf(ctx);
  const given = (rawArgs as { friend?: unknown }).friend;
  if (given === undefined && candidates.length === 1) return { ...rawArgs, friend: candidates[0] };
  if (typeof given !== "string") return rawArgs;
  const wanted = given.trim().toLowerCase();
  const match = candidates.find((candidate) => candidate === wanted || getPersona(candidate).displayName.toLowerCase() === wanted);
  return match ? { ...rawArgs, friend: match } : rawArgs;
}

export async function sendToFriend(ctx: AgentRuntimeContext, rawArgs: unknown, meta?: ToolMeta): Promise<SendResult> {
  const parsed = SendToFriendArgs.safeParse(normalizeArgs(ctx, rawArgs));
  if (!parsed.success) return fail(`Invalid message. ${z.prettifyError(parsed.error)}`);
  const args = parsed.data;

  const friend = args.friend;
  const candidates = counterpartsOf(ctx);
  if (!candidates.includes(friend)) {
    return fail(`You can only message ${candidates.map((candidate) => `${getPersona(candidate).displayName}'s agent (friend: "${candidate}")`).join(" or ")}.`);
  }
  // A coordinator talks to several friends in one turn, each on its own pair thread.
  const contextId = ctx.contexts?.[friend] ?? ctx.contextId;

  const { store } = ctx;
  // Second lock on the same door: a thread for a follow-up opens only for a contact who passes the gate,
  // whoever calls this and however.
  if (ctx.target && !(await store.getThread(ctx.contextId))) {
    const contact = getContact(ctx.target);
    if (!contact || !startGate(contact).ok) return fail("This person does not follow you back, so no conversation can be opened with them.");
  }
  const nowMs = ctx.wallNow?.() ?? Date.now();
  const at = toCentralIso(nowMs);

  const thread = await store.getThread(contextId);
  const prior = (await store.listMessages(contextId)).map((record) => record.message);
  if (!thread && !ctx.signalId && !ctx.target) return fail("There is no open conversation to send into.");
  if (thread && ENDED.has(thread.state)) return fail("This conversation has already ended. Do not send anything else.");

  const seq = (thread?.messageCount ?? 0) + 1;
  if (seq > THREAD_CAP) return fail(`A conversation is capped at ${THREAD_CAP} messages.`);
  if (prior.at(-1)?.from === ctx.agent) return fail("It is not your turn. Wait for your friend's reply.");
  if (isForcedClose(seq) && !closesThread(args.type)) return fail(`This is message ${seq} of ${THREAD_CAP}: it must be an accept or a decline.`);

  // Windows must sit inside the sender's own verified free blocks.
  let windows: Window[] | undefined = args.windows;
  let windowsDropped = 0;
  if (windows && windows.length > 0) {
    const free = await ownFreeBlocks(store, ctx.agent);
    const tooLong = (window: Window) => toMs(window.end) - toMs(window.start) > MAX_WINDOW_HOURS * 3_600_000;
    const invalid = windows.filter((window) => !isSubsetOfBlocks(window, free) || tooLong(window));
    if (invalid.length > 0) {
      if (ctx.windowRepairs.used === 0) {
        ctx.windowRepairs.used += 1;
        return fail(
          `These windows are not usable: ${invalid.map(describeWindow).join(", ")}. ` +
            `Each window must sit inside a free block from get_my_calendar and be at most ${MAX_WINDOW_HOURS} hours long. Narrow it to the part that suits the plan.`,
        );
      }
      windows = windows.filter((window) => isSubsetOfBlocks(window, free) && !tooLong(window));
      windowsDropped = invalid.length;
    }
  }

  if (windows && windows.length === 0) windows = undefined;
  let type = args.type;
  let reason = args.reason;
  if (windowsDropped > 0 && (windows?.length ?? 0) === 0) {
    if (type === "accept") return fail("None of the window you tried to accept is free on your calendar, so you cannot accept it.");
    if (type === "propose" || type === "counter") {
      type = "counter";
      reason = "no_overlap";
    }
  }

  // An accept must agree to a window the friend actually offered.
  const friendLast = [...prior].reverse().find((message) => message.from !== ctx.agent);
  if (type === "accept" && windows?.[0] && friendLast?.windows && !friendLast.windows.some((offered) => isSubsetOfBlocks(windows![0], [offered]))) {
    return fail("You can only accept a window your friend offered. Counter with your own windows instead.");
  }

  // In a group, the coordinator may only accept a window that works for everyone, worked out in code.
  const isCoordinator = ctx.group !== undefined && ctx.agent === ctx.group.coordinator;
  if (isCoordinator && type === "accept" && windows?.[0]) {
    const plan = await planForContext(store, contextId);
    const everyone = plan ? await groupCandidates(store, plan) : [];
    if (!isSubsetOfBlocks(windows[0], everyone)) {
      return fail(`That window is not free for everyone in the group. Accept one of these, copied exactly: ${describeCandidates(everyone)}.`);
    }
  }
  // The coordinator relays windows only: a note could carry one member's availability to another.
  const note = isCoordinator ? undefined : args.note;

  // Do not re-offer a window that was already passed over in this thread.
  const ledger = new Set(await store.listRejectedWindows(contextId));
  const repeated = (windows ?? []).filter((window) => ledger.has(windowHash(window)));
  if (repeated.length > 0) return fail(`These windows were already passed over in this conversation: ${repeated.map(describeWindow).join(", ")}. Offer different ones.`);

  const sender = getPersona(ctx.agent);
  const policy = await store.getPolicy(ctx.agent, friend);
  const shared = projectShared(sender, args.share, policy);

  const draft = {
    id: newId("msg", nowMs),
    contextId,
    seq,
    from: ctx.agent,
    to: friend,
    type,
    state: "working" as const,
    activity: args.activity,
    windows,
    reason,
    note,
    shared,
    at,
  };
  const state = nextThreadState({ from: ctx.agent, type, windows }, prior);
  const outcome = enforceSharePolicy({ message: { ...draft, state }, policy, sender, windowsDropped });

  const final = AgentMessage.safeParse(outcome.message);
  if (!final.success) {
    return fail(
      "Your human's sharing settings for this friend do not allow this message to go out as written " +
        `(${outcome.removed.join(", ") || "policy"} removed). Send a message that does not depend on it, such as an intent with a short note, or a decline.`,
    );
  }

  const record: MessageRecord = {
    message: final.data,
    stamp: outcome.stamp,
    delivery: "delivered",
    proof: meta
      ? {
          model: meta.model,
          ...(meta.call.fallbackFrom ? { fallbackFrom: meta.call.fallbackFrom } : {}),
          responseId: meta.responseId,
          latencyMs: meta.call.ms,
          inputTokens: meta.call.inputTokens,
          outputTokens: meta.call.outputTokens,
          reasoningTokens: meta.call.reasoningTokens,
          // The tools called on the way here, ending with this send, so the drawer can list them.
          toolCalls: [...meta.toolCalls, summarizeToolCall({ name: "send_to_friend_agent", args, output: { seq, state: final.data.state }, ok: true })].slice(-10),
        }
      : undefined,
  };
  const delivery = ctx.deliver ? await ctx.deliver({ record, redaction: outcome.redaction }) : (await commitMessage(store, record, outcome.redaction), { ok: true as const });
  if (!delivery.ok) return fail(`Your friend's inbox rejected the message (${delivery.status}): ${delivery.error}`);

  return { ok: true, seq, state: final.data.state, delivered: true };
}
