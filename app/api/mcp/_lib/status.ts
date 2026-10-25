import type { McpAccount } from "./auth";

export type StoreSummary = {
  kind: string;
  threads: number;
  messages: number;
  plans: number;
  cards: number;
  events: number;
};

export type McpStatus = {
  ok: true;
  service: "muse-friends";
  deploy: string;
  account: McpAccount;
  store: StoreSummary | { kind: "not-connected" };
  at: string;
};

export function buildStatus(account: McpAccount, store: McpStatus["store"], now: Date = new Date()): McpStatus {
  return {
    ok: true,
    service: "muse-friends",
    deploy: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    account,
    store,
    at: now.toISOString(),
  };
}

// The one place the connector reads app state. It reports "not-connected" until the Store
// factory from lib/store lands on main; then this reads a snapshot and counts it.
export async function readStoreSummary(): Promise<McpStatus["store"]> {
  return { kind: "not-connected" };
}
