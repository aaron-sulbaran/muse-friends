import { initialOnboarding, loadOnboarding, reduceOnboarding, saveOnboarding, type OnboardingAction, type OnboardingState } from "./onboarding";
import type { Role } from "./types";

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

const keyOf = (room: string, role: Role) => `${room}|${role}`;

/** The room's onboarding state for a side: the session's, else what was saved, else the first step. */
export function readOnboarding(room: string, role: Role = "a"): OnboardingState {
  let state = states.get(keyOf(room, role));
  if (!state) {
    state = loadOnboarding(room, role);
    states.set(keyOf(room, role), state);
  }
  return state;
}

export function dispatchOnboarding(room: string, action: OnboardingAction, role: Role = "a"): void {
  const before = readOnboarding(room, role);
  const after = reduceOnboarding(before, action);
  if (after === before) return;
  states.set(keyOf(room, role), after);
  saveOnboarding(room, after, role);
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
