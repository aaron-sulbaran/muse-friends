import type { Role, UiPlan } from "./types";

/*
 * How a judge's phone gets from the front door to a side. The chooser on the root page links to /a or /b;
 * "Play with a simulated friend" links to /a with this flag, and that page starts the game once and
 * takes the flag back out of the address so a reload does not start it again.
 */

export const FRIEND_PARAM = "friend";

export const simulatedFriendHref = `/a?${FRIEND_PARAM}=1`;

export function sideHref(role: Role): string {
  return role === "a" ? "/a" : "/b";
}

export function otherRole(role: Role): Role {
  return role === "a" ? "b" : "a";
}

/** True when the address asks to start with the simulated friend (`search` is `location.search`). */
export function wantsSimulatedFriend(search: string): boolean {
  return new URLSearchParams(search).get(FRIEND_PARAM) === "1";
}

/**
 * A run still going in the room, which a judge's arrival must not wipe. A plan that was dropped or has
 * come all the way round to follow-up is over, and choosing the simulated friend starts a fresh game.
 */
export function runInProgress(plan: UiPlan | null): boolean {
  return plan !== null && plan.state !== "dropped" && plan.state !== "followed_up";
}
