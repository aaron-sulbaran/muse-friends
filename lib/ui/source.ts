import {
  buildFixtureSnapshot,
  initialFixtureState,
  reduceFixture,
  type FixtureAction,
  type FixtureState,
} from "./fixture";
import type { UiSnapshot } from "./types";

/*
 * Where the UI's snapshot comes from. Today that is Lane B's own recorded run,
 * held in module state so two browser tabs (the two phones) see the same
 * thing. When the Store interface lands this file maps the store's threads,
 * plans, and redactions onto UiSnapshot and the fixture goes away.
 */

const holder = globalThis as unknown as { __museFixtureState?: FixtureState };

function currentState(): FixtureState {
  holder.__museFixtureState ??= initialFixtureState();
  return holder.__museFixtureState;
}

export function readSnapshot(): UiSnapshot {
  return buildFixtureSnapshot(currentState());
}

export function dispatch(action: FixtureAction): UiSnapshot {
  holder.__museFixtureState = reduceFixture(currentState(), action);
  return readSnapshot();
}
