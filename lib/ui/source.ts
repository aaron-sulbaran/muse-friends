import { runBudget } from "@/lib/agent/caps";
import { getLiveReel } from "@/lib/instagram";
import { getStore } from "@/lib/store";
import { toUiSnapshot } from "./snapshot";
import type { UiSnapshot } from "./types";

/*
 * Where the UI's snapshot comes from: the store the agents write to, through
 * the one Store interface (JSON locally, Supabase in production). `cursor`
 * changes whenever any state changes, so a poll with nothing new is answered
 * with a 304 without reading the snapshot.
 */

/** Replay mode is Lane B's own overlay; until the player exists everything the store holds is live. */
const mode = "live" as const;

export async function readCursor(): Promise<string> {
  const store = await getStore();
  return `${mode}-${await store.cursor()}`;
}

export async function readSnapshot(): Promise<UiSnapshot> {
  const store = await getStore();
  return toUiSnapshot(await store.snapshot(), { mode, budget: runBudget(), liveReel: await getLiveReel() });
}
