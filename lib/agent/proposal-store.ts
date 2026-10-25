import { PaymentProposal } from "@/lib/protocol";
import type { Store } from "@/lib/store";
import { withLock } from "./lock";

// Payment proposals live on the room (jsonb, no migration): a payment the Muse has prepared and the person has
// not yet decided. Reset starts the room over, so they go with it.

const OPEN: PaymentProposal["status"][] = ["proposed", "confirming", "failed"];

export async function getProposal(store: Store, paymentId: string): Promise<PaymentProposal | null> {
  return (await store.getRoom()).proposals?.[paymentId] ?? null;
}

export async function listProposals(store: Store): Promise<PaymentProposal[]> {
  return Object.values((await store.getRoom()).proposals ?? {}).sort((a, b) => a.proposedAt.localeCompare(b.proposedAt));
}

// Writes one proposal, validated, without disturbing the rest of the room.
export async function putProposal(store: Store, proposal: PaymentProposal): Promise<void> {
  const valid = PaymentProposal.parse(proposal);
  await withLock("room-proposals", async () => {
    const room = await store.getRoom();
    await store.putRoom({ ...room, proposals: { ...room.proposals, [valid.paymentId]: valid } });
  });
}

// A proposal for this plan and payer that is still waiting on the person (or failed and can be retried).
export async function openProposalFor(store: Store, planId: string, payer: PaymentProposal["payer"]): Promise<PaymentProposal | null> {
  return (await listProposals(store)).find((proposal) => proposal.planId === planId && proposal.payer === payer && OPEN.includes(proposal.status)) ?? null;
}
