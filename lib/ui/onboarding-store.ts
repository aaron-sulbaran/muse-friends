import { initialOnboarding, loadOnboarding, reduceOnboarding, saveOnboarding, type OnboardingAction, type OnboardingState } from "./onboarding";

/*
 * Onboarding state for the screen, outside React so it can be read by a hook and tested in node. The state lives in
 * memory for the session and is written through to sessionStorage under the room's id: a reload resumes the same step,
 * and a blocked storage (a private window) still lets the flow advance, it just does not survive a reload. A tiny
 * store, so the hook can use useSyncExternalStore: the server renders the first step, the browser then reads what was
 * saved, with no state set inside an effect.
 */

const states = new Map<string, OnboardingState>();
const listeners = new Set<() => void>();

/** What the server, and the first client render, show. Stable, so React does not see a change. */
export const serverOnboarding: OnboardingState = initialOnboarding();

/** The room's onboarding state: the session's, else what was saved, else the first step. */
export function readOnboarding(room: string): OnboardingState {
  let state = states.get(room);
  if (!state) {
    state = loadOnboarding(room);
    states.set(room, state);
  }
  return state;
}

export function dispatchOnboarding(room: string, action: OnboardingAction): void {
  const before = readOnboarding(room);
  const after = reduceOnboarding(before, action);
  if (after === before) return;
  states.set(room, after);
  saveOnboarding(room, after);
  for (const listener of listeners) listener();
}

export function subscribeOnboarding(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** For tests: forget everything held in memory, as a reload does. */
export function resetOnboardingStore(): void {
  states.clear();
  listeners.clear();
}
