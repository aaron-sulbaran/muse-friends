import type { AgentId } from "@/lib/protocol";
import type { NessieCustomerInput } from "@/lib/nessie";

// What each seat's wallet starts with. Fictional names and addresses only: everything written to the Nessie
// sandbox is readable by every team. The Michelle seat (the simulated friend) uses Mochi's wallet.
export type WalletSeed = { customer: NessieCustomerInput; nickname: string; startingBalance: number };

const ADDRESS = { street_number: "100", street_name: "Demo Way", city: "Austin", state: "TX", zip: "78701" };

export const WALLET_SEEDS: Record<AgentId, WalletSeed> = {
  aaron: { customer: { first_name: "Sprout", last_name: "Muse Demo", address: ADDRESS }, nickname: "Sprout's wallet", startingBalance: 120 },
  lisa: { customer: { first_name: "Mochi", last_name: "Muse Demo", address: ADDRESS }, nickname: "Mochi's wallet", startingBalance: 80 },
};
