import { createHash } from "node:crypto";
import { buildStateSnapshot, initialScriptState, reduceScript, type ScriptAction, type ScriptState } from "./script";
import { toUiSnapshot } from "./snapshot";
import type { UiSnapshot } from "./types";

/*
 * Where the UI's snapshot comes from. Today it is Lane A's recorded run played
 * stage by stage (lib/ui/script.ts), held in module state so two browser tabs
 * (the two phones) see the same plan. When getStore() lands this reads
 * `store.snapshot()` and `store.cursor()` instead; everything downstream already
 * consumes a StateSnapshot through toUiSnapshot.
 */

const holder = globalThis as unknown as { __museScriptState?: ScriptState };

function currentState(): ScriptState {
  holder.__museScriptState ??= initialScriptState();
  return holder.__museScriptState;
}

export function readSnapshot(): UiSnapshot {
  const state = currentState();
  return toUiSnapshot(buildStateSnapshot(state), { mode: state.mode });
}

/** Changes whenever anything the UI shows changes, so a poll can be answered with 304. */
export function readCursor(snapshot: UiSnapshot): string {
  return createHash("sha1").update(JSON.stringify(snapshot)).digest("hex").slice(0, 16);
}

export function dispatch(action: ScriptAction): UiSnapshot {
  holder.__museScriptState = reduceScript(currentState(), action);
  return readSnapshot();
}
