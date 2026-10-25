import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AGENT_IDS, ModelProof, PolicyStamp, Redaction, type AgentId, type TaskState } from "@/lib/protocol";
import { validateIncoming } from "@/lib/policy";
import { getPersona, displayName } from "@/lib/seed/fixtures";
import type { Store } from "@/lib/store";
import type { AgentRuntimeContext } from "./context";
import { ownFreeBlocks } from "./calendar";
import { commitMessage } from "./inbound";
import { newId } from "./ids";
import { toCentralIso } from "./windows";

// The wire between the two agents: a bearer-authenticated HTTP inbox per agent. The bearer token
// names the sender. Tokens come from AGENT_TOKEN_AARON / AGENT_TOKEN_LISA when set, otherwise they
// are derived from MODEL_API_KEY, so a public deployment needs no extra secret to stay closed.

export function agentToken(agent: AgentId): string {
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
export function authenticateSender(header: string | null): AgentId | null {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  if (!match) return null;
  return AGENT_IDS.find((agent) => sameToken(match[1], agentToken(agent))) ?? null;
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
  | { ok: true; status: 202; body: { contextId: string; seq: number; state: TaskState }; runTurn: boolean }
  | { ok: false; status: 400 | 403 | 409 | 422; error: string };

export async function receiveMessage(
  store: Store,
  input: { recipient: AgentId; sender: AgentId; envelope: unknown; wallNow?: () => number },
): Promise<ReceiveResult> {
  const envelope = Envelope.safeParse(input.envelope);
  if (!envelope.success) return { ok: false, status: 400, error: `Invalid envelope. ${z.prettifyError(envelope.error)}` };

  const contextId = typeof (envelope.data.message as { contextId?: unknown } | null)?.contextId === "string" ? (envelope.data.message as { contextId: string }).contextId : "";
  const thread = contextId ? await store.getThread(contextId) : null;
  const prior = contextId ? (await store.listMessages(contextId)).map((record) => record.message) : [];

  // A retry of a message already committed is acknowledged, not applied twice.
  const seq = (envelope.data.message as { seq?: unknown } | null)?.seq;
  const duplicate = prior.find((message) => message.seq === seq && message.id === (envelope.data.message as { id?: unknown }).id);
  if (duplicate) return { ok: true, status: 202, body: { contextId, seq: duplicate.seq, state: duplicate.state }, runTurn: false };

  const check = validateIncoming({
    raw: envelope.data.message,
    authenticatedSender: input.sender,
    recipient: input.recipient,
    thread,
    prior,
    senderFreeBlocks: await ownFreeBlocks(store, input.sender),
    senderPolicy: await store.getPolicy(input.sender, input.recipient),
    senderPersona: getPersona(input.sender),
    rejectedWindowHashes: contextId ? await store.listRejectedWindows(contextId) : [],
  });

  if (!check.ok) {
    const now = input.wallNow?.() ?? Date.now();
    const plan = contextId ? await store.getPlanByContext(contextId) : null;
    await store.appendEvent({
      id: newId("evt", now),
      at: toCentralIso(now),
      kind: "message_rejected",
      actor: "system",
      agent: input.recipient,
      contextId: contextId || undefined,
      planId: plan?.id,
      text: `${displayName(input.recipient)}'s inbox rejected a message from ${displayName(input.sender)} (${check.status}): ${check.error}`.slice(0, 240),
    });
    return { ok: false, status: check.status, error: check.error };
  }

  await commitMessage(store, { message: check.message, stamp: envelope.data.stamp, proof: envelope.data.proof, delivery: "delivered", httpStatus: 202 }, envelope.data.redaction);
  return {
    ok: true,
    status: 202,
    body: { contextId: check.message.contextId, seq: check.message.seq, state: check.message.state },
    runTurn: check.message.state === "working",
  };
}

// Sends an outgoing message to the friend's inbox over HTTP, as the sender.
export function httpDeliver(origin: string, sender: AgentId): NonNullable<AgentRuntimeContext["deliver"]> {
  return async ({ record, redaction }) => {
    const url = `${origin}/api/agents/${record.message.to}/inbox`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${agentToken(sender)}` },
        body: JSON.stringify({ message: record.message, stamp: record.stamp, redaction, proof: record.proof }),
        signal: AbortSignal.timeout(30_000),
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
export function localDeliver(store: Store, sender: AgentId, onAccepted?: (result: Extract<ReceiveResult, { ok: true }>) => void): NonNullable<AgentRuntimeContext["deliver"]> {
  return async ({ record, redaction }) => {
    const result = await receiveMessage(store, { recipient: record.message.to, sender, envelope: { message: record.message, stamp: record.stamp, redaction, proof: record.proof } });
    if (!result.ok) return { ok: false, status: result.status, error: result.error };
    onAccepted?.(result);
    return { ok: true };
  };
}
