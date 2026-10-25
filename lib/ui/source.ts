import { buildStateSnapshot, initialScriptState, reduceScript, type ScriptAction, type ScriptState } from "./script";
import { toUiSnapshot } from "./snapshot";
import type { UiSnapshot } from "./types";

/*
 * Where the UI's snapshot comes from. Today it is Lane A's recorded run played
 * stage by stage (lib/ui/script.ts), held in module state so two browser tabs
 * (the two phones) see the same plan. When the live store is wired, this reads
 * `store.snapshot()` instead; everything downstream already consumes a
 * StateSnapshot through toUiSnapshot.
 */

const holder = globalThis as unknown as { __museScriptState?: ScriptState };

function currentState(): ScriptState {
  holder.__museScriptState ??= initialScriptState();
  return holder.__museScriptState;
}

export function readSnapshot(): UiSnapshot {
  const state = currentState();
  return toUiSnapshot(buildStateSnapshot(state), { mode: state.mode, simulatedFriend: state.simulatedFriend });
}

export function dispatch(action: ScriptAction): UiSnapshot {
  holder.__museScriptState = reduceScript(currentState(), action);
  return readSnapshot();
}
