import type { RecordedRun } from "@/lib/protocol";
import { snapshotAtPlanState } from "@/lib/seed/states";
import type { Store } from "@/lib/store";
import { buildReplay, pickRun, progressOf, type Replay } from "./replay";

/**
 * The scripted run Replay falls back to: Lane A's fixture states carried through
 * the follow-up. It is a recording, never a live run, and says so by its source.
 */
export function scriptedRun(): RecordedRun {
  const snapshot = snapshotAtPlanState("followed_up");
  return {
    id: "run_scripted_full",
    label: "Scripted shawarma run, signal to follow-up",
    scenario: "shawarma",
    source: "scripted",
    recordedAt: snapshot.clock.now,
    snapshot,
  };
}

/** The best recorded run in the store, unless the scripted run gets further. */
export async function loadReplay(store: Store): Promise<Replay> {
  const saved = pickRun(await store.listRecordedRuns());
  const scripted = scriptedRun();
  const chosen = saved && progressOf(saved.snapshot) >= progressOf(scripted.snapshot) ? saved : scripted;
  return buildReplay(chosen);
}
