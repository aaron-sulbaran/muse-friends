import { Wallet } from "lucide-react";
import { walletChipFor } from "@/lib/ui/payments";
import type { AgentId, UiSnapshot } from "@/lib/ui/types";

/**
 * The seat's balance in whole paper dollars, with the sandbox named, under the Muse's name. It shows only when
 * the wallets live on the real Capital One sandbox; over the local ledger it is hidden rather than dressed up.
 */
export function WalletChip({ snapshot, agent }: { snapshot: Pick<UiSnapshot, "wallets" | "sandbox">; agent: AgentId }) {
  const chip = walletChipFor(snapshot, agent);
  if (!chip) return null;
  return (
    <p className="flex items-center gap-1.5 rounded-full bg-group px-2.5 py-1 text-[12px] leading-4" aria-label={`Balance ${chip.balance}, ${chip.label}`}>
      <Wallet className="size-3.5" strokeWidth={1.75} aria-hidden="true" />
      <span className="font-semibold tabular-nums">{chip.balance}</span>
      <span className="text-muted">{chip.label}</span>
    </p>
  );
}
