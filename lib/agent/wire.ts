import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { MEMBER_IDS, ModelProof, PolicyStamp, Redaction, isPaymentType, isTripType, type MemberId, type TaskState } from "@/lib/protocol";
import { validateIncoming, type IncomingCheck } from "@/lib/policy";
import { validatePaymentIncoming } from "./payment-rules";
import { validateTripIncoming } from "./trip-rules";
import { getPersona, displayName } from "@/lib/seed/fixtures";
import type { Store } from "@/lib/store";
import type { AgentRuntimeContext } from "./context";
import { ownFreeBlocks } from "./calendar";
import { claimCoordinatorTurn, planForContext } from "./group";
import { commitMessageCore } from "./inbound";
import { withLock } from "./lock";
import { newId, seatOf } from "./ids";
import { toCentralIso } from "./windows";

// The wire between the two agents: a bearer-authenticated HTTP inbox per agent. The bearer token
// names the sender. Tokens come from AGENT_TOKEN_AARON / AGENT_TOKEN_LISA when set, otherwise they
// are derived from MODEL_API_KEY, so a public deployment needs no extra secret to stay closed.

export function agentToken(agent: MemberId): string {
  const configured = process.env[`AGENT_TOKEN_${agent.toUpperCase()}`];
  if (configured) return configured;
  return createHmac("sha256", process.env.MODEL_API_KEY ?? "muse-friends-local-dev").update(`agent:${agent}`).digest("hex");
}

function sameToken(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// The agent a bearer header belongs to, or null.
export function authenticateSender(header: string | null): MemberId | null {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (!match) return null;
  return MEMBER_IDS.find((agent) => sameToken(match[1], agentToken(agent))) ?? null;
}

// What travels in the POST body: the wire message plus the sender's policy stamp and redaction,
// which are the sender's audit trail for the Activity timeline.
export const Envelope = z.strictObject({
  message: z.unknown(),
  stamp: PolicyStamp,
  redaction: Redaction.nullable(),
  proof: ModelProof.optional(),
});

export type ReceiveResult =
  | {
      ok: true;
      status: 202;
      body: { contextId: string; seq: number; state: TaskState };
      runTurn: boolean;
      // The deferred half of the commit (timeline rows, redaction, ledger). Await it before running the turn.
      finish: () => Promise<void>;
    }
  | { ok: false; status: 400 | 403 | 409 | 422; error: string };

export async function receiveMessage(
  store: Store,
  input: { recipient: MemberId; sender: MemberId; envelope: unknown; wallNow?: () => number },
): Promise<ReceiveResult> {
  const envelope = Envelope.safeParse(input.envelope);
  if (!envelope.success) return { ok: false, status: 400, error: `Invalid envelope. ${z.prettifyError(envelope.error)}` };

  const loose = envelope.data.message as { contextId?: unknown; seq?: unknown; id?: unknown } | null;
  const contextId = typeof loose?.contextId === "string" ? loose.contextId : "";
  // One message into a thread at a time, so a retry that races its original cannot commit twice.
  return withLock(`thread:${contextId || "none"}`, async () => {
    // Every read the checks need goes out together: the 202 waits one store round trip for them, not six.
    const [thread, priorRecords, senderFreeBlocks, senderPolicy, rejectedWindowHashes] = await Promise.all([
      contextId ? store.getThread(contextId) : Promise.resolve(null),
      contextId ? store.listMessages(contextId) : Promise.resolve([]),
      ownFreeBlocks(store, input.sender),
      store.getPolicy(input.sender, input.recipient),
      contextId ? store.listRejectedWindows(contextId) : Promise.resolve([]),
    ]);
    const prior = priorRecords.map((record) => record.message);

    // A retry of a message already committed is acknowledged, not applied twice.
    const duplicate = prior.find((message) => message.seq === loose?.seq && message.id === loose?.id);
    if (duplicate) return { ok: true, status: 202, body: { contextId, seq: duplicate.seq, state: duplicate.state }, runTurn: false, finish: async () => {} } as const;

    const generic = validateIncoming({
      raw: envelope.data.message,
      authenticatedSender: input.sender,
      recipient: input.recipient,
      thread,
      prior,
      senderFreeBlocks,
      senderPolicy,
      senderPersona: getPersona(input.sender),
      rejectedWindowHashes,
    });

    // A payment message gets the payments checks on top: its plan, the sender's own wallet, the cap, the open payment.
    let check: IncomingCheck = generic;
    if (generic.ok && isPaymentType(generic.message.type)) {
      const extra = await validatePaymentIncoming(store, generic.message, senderPolicy);
      if (!extra.ok) check = { ok: false, status: extra.status, error: extra.error };
    }

    // A trip message gets the trip checks: its plan, the star, and that the numbers are the person's and the seed's.
    if (generic.ok && isTripType(generic.message.type)) {
      const extra = await validateTripIncoming(store, generic.message);
      if (!extra.ok) check = { ok: false, status: extra.status, error: extra.error };
    }

    if (!check.ok) {
      const now = input.wallNow?.() ?? Date.now();
      const plan = contextId ? await store.getPlanByContext(contextId) : null;
      await store.appendEvent({
        id: newId("evt", now),
        at: toCentralIso(now),
        kind: "message_rejected",
        actor: "system",
        agent: seatOf(input.recipient),
        contextId: contextId || undefined,
        planId: plan?.id,
        text: `${displayName(input.recipient)}'s inbox rejected a message from ${displayName(input.sender)} (${check.status}): ${check.error}`.slice(0, 240),
      });
      return { ok: false, status: check.status, error: check.error } as const;
    }

    const committed = await commitMessageCore(
      store,
      { message: check.message, stamp: envelope.data.stamp, proof: envelope.data.proof, delivery: "delivered", httpStatus: 202 },
      envelope.data.redaction,
    );
    // In a group the coordinator waits for every friend to answer, then runs once.
    // A trip message never starts a negotiation turn: the trip engine drives the trip.
    let runTurn = committed.threadState === "working" && !isTripType(check.message.type);
    if (runTurn && thread?.groupId) {
      const plan = await planForContext(store, check.message.contextId);
      if (plan?.group && input.recipient === plan.group.coordinator) runTurn = await claimCoordinatorTurn(store, plan.id);
    }
    return {
      ok: true,
      status: 202,
      body: { contextId: check.message.contextId, seq: check.message.seq, state: committed.threadState },
      runTurn,
      finish: committed.finish,
    } as const;
  });
}

// Sends an outgoing message to the friend's inbox over HTTP, as the sender.
export function httpDeliver(origin: string, sender: MemberId): NonNullable<AgentRuntimeContext["deliver"]> {
  return async ({ record, redaction }) => {
    const url = `${origin}/api/agents/${record.message.to}/inbox`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${agentToken(sender)}` },
        body: JSON.stringify({ message: record.message, stamp: record.stamp, redaction, proof: record.proof }),
        signal: AbortSignal.timeout(Number(process.env.INBOX_TIMEOUT_MS ?? 60_000)),
      });
      if (response.status === 202 || response.status === 200) return { ok: true };
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      return { ok: false, status: response.status, error: body.error ?? response.statusText };
    } catch (error) {
      return { ok: false, status: 0, error: error instanceof Error ? error.message : String(error) };
    }
  };
}

// Same wire without the network, for tests and for running agents in one process.
export function localDeliver(store: Store, sender: MemberId, onAccepted?: (result: Extract<ReceiveResult, { ok: true }>) => void): NonNullable<AgentRuntimeContext["deliver"]> {
  return async ({ record, redaction }) => {
    const result = await receiveMessage(store, { recipient: record.message.to, sender, envelope: { message: record.message, stamp: record.stamp, redaction, proof: record.proof } });
    if (!result.ok) return { ok: false, status: result.status, error: result.error };
    await result.finish();
    onAccepted?.(result);
    return { ok: true };
  };
}
