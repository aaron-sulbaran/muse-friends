import { getStore, type Store } from "@/lib/store";
import type { McpAccount } from "./auth";

export type StoreSummary = {
  kind: "supabase" | "json";
  threads: number;
  messages: number;
  plans: number;
  cards: number;
  events: number;
};

export type StoreProblem = { kind: "supabase" | "json"; error: string };

export type ConnectorStatus = {
  ok: boolean;
  service: "muse-friends";
  deploy: string;
  account: McpAccount;
  store: StoreSummary | StoreProblem;
  at: string;
};

function storeKind(): "supabase" | "json" {
  return process.env.STORE === "supabase" ? "supabase" : "json";
}

// The one place the connector reads app state: counts from one snapshot, never the content of any
// thread, so a connected Muse learns that the service is alive and how busy it is, nothing more.
// A store that cannot be read is reported, not thrown, so get_status still answers.
export async function readStoreSummary(store?: Store): Promise<StoreSummary | StoreProblem> {
  const kind = storeKind();
  try {
    const snapshot = await (store ?? (await getStore())).snapshot();
    return {
      kind,
      threads: snapshot.threads.length,
      messages: snapshot.messages.length,
      plans: snapshot.plans.length,
      cards: snapshot.cards.length,
      events: snapshot.events.length,
    };
  } catch (error) {
    return { kind, error: error instanceof Error ? error.message : "store unavailable" };
  }
}

export function buildStatus(account: McpAccount, store: StoreSummary | StoreProblem, now: Date = new Date()): ConnectorStatus {
  return {
    ok: !("error" in store),
    service: "muse-friends",
    deploy: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    account,
    store,
    at: now.toISOString(),
  };
}
