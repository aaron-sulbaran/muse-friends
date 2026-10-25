import { AGENT_IDS, type AgentId, type Room, type Wallet } from "@/lib/protocol";
import { LocalLedger, NessieWithLedger, nessieFromEnvironment, type LedgerStorage, type NessieClient, type NessieResult, fail, ok } from "@/lib/nessie";
import { WALLET_SEEDS } from "@/lib/seed/wallets";
import type { Store } from "@/lib/store";
import { withLock } from "./lock";
import { toCentralIso } from "./windows";

// Wallets: one checking account per seat, on the Nessie sandbox when NESSIE_KEY is set and on the local ledger
// otherwise. The ids and the last balance read live on the room (jsonb, no migration). A wallet keeps talking
// to the ledger it was created on, so adding the key later changes nothing until the next Reset.

export const PAYMENTS_OFF_TEXT = "Payments are switched off";

// PAYMENTS=off turns the whole feature off: no wallets, no tools, no routes.
export function paymentsEnabled(): boolean {
  return process.env.PAYMENTS !== "off";
}

// The local ledger keeps its balances on the room so every instance of the app sees the same numbers.
export function roomLedger(store: Store): LedgerStorage {
  return {
    read: async () => (await store.getRoom()).localLedger ?? {},
    write: async (next) => {
      const room = await store.getRoom();
      await store.putRoom({ ...room, localLedger: next });
    },
    exclusive: (work) => withLock("local-ledger", work),
  };
}

// The client for a wallet's own ledger. A Nessie wallet needs the key; without it the wallet is read-only dead
// weight and the caller reports a sandbox error.
export function clientFor(store: Store, source: Wallet["source"]): NessieClient | null {
  if (source === "local") return new LocalLedger(roomLedger(store));
  const http = nessieFromEnvironment();
  return http ? new NessieWithLedger(http, roomLedger(store)) : null;
}

export async function walletOf(store: Store, agent: AgentId): Promise<Wallet | null> {
  return (await store.getRoom()).wallets?.[agent] ?? null;
}

async function saveWallet(store: Store, wallet: Wallet): Promise<void> {
  await withLock("room-wallets", async () => {
    const room = await store.getRoom();
    await store.putRoom({ ...room, wallets: { ...room.wallets, [wallet.owner]: wallet } });
  });
}

// Reads the balance back from the ledger and keeps it on the room. The balance is never computed here.
export async function refreshWallet(store: Store, agent: AgentId, now: () => number = Date.now): Promise<NessieResult<Wallet>> {
  const wallet = await walletOf(store, agent);
  if (!wallet) return fail("no wallet for this seat");
  const client = clientFor(store, wallet.source);
  if (!client) return fail("sandbox not connected");
  const account = await client.getAccount(wallet.accountId);
  if (account.error !== null) return fail(account.error);
  const next: Wallet = { ...wallet, balance: account.data.balance, updatedAt: toCentralIso(now()) };
  if (next.balance !== wallet.balance) await saveWallet(store, next);
  return ok(next);
}

// Creates the wallets that are missing and puts the ones that exist back to their starting balance. Called at
// Reset; a failure here never fails the Reset (the wallet chip just shows no balance until the next try).
export async function ensureWallets(store: Store, now: () => number = Date.now): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  const key = nessieFromEnvironment();
  const source: Wallet["source"] = key ? "nessie" : "local";
  const client: NessieClient = key ? new NessieWithLedger(key, roomLedger(store)) : new LocalLedger(roomLedger(store));

  for (const agent of AGENT_IDS) {
    const seed = WALLET_SEEDS[agent];
    const existing = (await store.getRoom()).wallets?.[agent];
    const at = toCentralIso(now());

    if (existing && existing.source === source) {
      const account = await client.getAccount(existing.accountId);
      if (account.error === null) {
        const difference = seed.startingBalance - account.data.balance;
        const moved = difference === 0 ? ok({ id: "" }) : difference > 0 ? await client.deposit(existing.accountId, { amount: difference, description: "Muse demo reset" }) : await client.withdraw(existing.accountId, { amount: -difference, description: "Muse demo reset" });
        if (moved.error !== null) {
          errors.push(`${agent}: ${moved.error}`);
          continue;
        }
        const reread = difference === 0 ? account : await client.getAccount(existing.accountId);
        await saveWallet(store, { ...existing, balance: reread.error === null ? reread.data.balance : seed.startingBalance, startingBalance: seed.startingBalance, updatedAt: at });
        continue;
      }
      // The account is gone (the sandbox lost it): make a new one below.
    }

    const customer = await client.createCustomer(seed.customer);
    if (customer.error !== null) {
      errors.push(`${agent}: ${customer.error}`);
      continue;
    }
    const account = await client.createAccount(customer.data.id, { nickname: seed.nickname, balance: seed.startingBalance });
    if (account.error !== null) {
      errors.push(`${agent}: ${account.error}`);
      continue;
    }
    await saveWallet(store, {
      owner: agent,
      customerId: customer.data.id,
      accountId: account.data.id,
      nickname: seed.nickname,
      balance: account.data.balance,
      startingBalance: seed.startingBalance,
      source,
      updatedAt: at,
    });
  }
  return { errors };
}

// What a Reset keeps of the old room: the wallets and the local ledger, so the same accounts are put back to their
// starting balance instead of piling up new customers in a sandbox every team can read.
export function carryWallets(previous: Room): Pick<Room, "wallets" | "localLedger"> {
  return { ...(previous.wallets ? { wallets: previous.wallets } : {}), ...(previous.localLedger ? { localLedger: previous.localLedger } : {}) };
}
