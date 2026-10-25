import type { AgentId } from "@/lib/protocol";
import type { Store } from "@/lib/store";
import { withLock } from "./lock";
import { toCentralIso } from "./windows";

// While a payer's Muse settles up (a settle turn that prepares a payment, or a confirm that moves the money), the room
// says so, so a phone can show "Settling up, 6 s" instead of nothing. The marker is a hint and never gates a payment:
// writing it is allowed to fail, a reader ignores one older than PAYING_TTL_MS, and the end of the work clears it
// whatever happened.

export const PAYING_TTL_MS = 120_000;

async function mark(store: Store, paying: { agent: AgentId; since: string } | null): Promise<void> {
  // The same lock as the wallets, which also read and write the room.
  await withLock("room-wallets", async () => {
    const room = { ...(await store.getRoom()) };
    delete room.paying;
    await store.putRoom(paying ? { ...room, paying } : room);
  });
}

export async function whilePaying<T>(store: Store, agent: AgentId, work: () => Promise<T>, wallNow?: () => number): Promise<T> {
  await mark(store, { agent, since: toCentralIso(wallNow?.() ?? Date.now()) }).catch(() => {});
  try {
    return await work();
  } finally {
    await mark(store, null).catch(() => {});
  }
}
