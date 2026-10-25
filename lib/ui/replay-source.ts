import type { RecordedRun } from "@/lib/protocol";
import { liveRunBundle } from "@/lib/seed/live";
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

const ms = (iso: string) => Date.parse(iso);

/**
 * The real recording: lib/seed/live-run.json, written by `pnpm demo:record` from a run on the live model, with its
 * messages, model proof and tool calls as they happened. Null when the file does not parse, has no messages, or
 * any message lacks model proof (a scripted fallback turn is not a real run, so it is never presented as one).
 */
export function recordedRun(): RecordedRun | null {
  try {
    const { run } = liveRunBundle();
    const messages = run.snapshot.messages;
    return messages.length > 0 && messages.every((record) => record.proof !== undefined) ? run : null;
  } catch {
    return null;
  }
}

/**
 * What Replay plays. The real recording, unless a run saved in the store from the stage is live, newer, and got at
 * least as far. If the recording cannot be used, the best saved run (when it gets as far as the script does), and
 * only then the hand-written script, which labels itself as scripted.
 */
export async function loadReplay(store: Store, recording: RecordedRun | null = recordedRun()): Promise<Replay> {
  const saved = pickRun((await store.listRecordedRuns()).filter((run) => run.source === "live"));
  if (recording) {
    const newer = saved !== null && progressOf(saved.snapshot) >= progressOf(recording.snapshot) && ms(saved.recordedAt) > ms(recording.recordedAt);
    return buildReplay(newer ? saved : recording);
  }
  const scripted = scriptedRun();
  return buildReplay(saved && progressOf(saved.snapshot) >= progressOf(scripted.snapshot) ? saved : scripted);
}
