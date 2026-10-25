import type { UiPlan } from "./types";

/*
 * How a judge's phone gets in. Scanning the QR opens the root page, which sends a phone straight to Sprout's side
 * of a room of its own with the simulated friend on (`friend=1` is that flag; the phone page acts on it once and
 * takes it back out of the address). There is no role to pick. Bringing a real friend in is the Invite sheet's
 * link to the friend's side of the same room.
 */

export const FRIEND_PARAM = "friend";

/** Where the root page sends a phone: Sprout's side of this room, with Michelle playing the friend. */
export function phoneRootHref(room: string): string {
  return `/a?room=${room}&${FRIEND_PARAM}=1`;
}

/** The link a friend opens to land in Mochi's side of the same room, with the simulated friend off. */
export function friendLink(origin: string, room: string): string {
  return `${origin}/b?room=${room}`;
}

/** True when the address asks for the simulated friend to be on (`search` is `location.search`). */
export function wantsSimulatedFriend(search: string): boolean {
  return new URLSearchParams(search).get(FRIEND_PARAM) === "1";
}

/**
 * A run still going in the room, which a judge's arrival must not wipe. A plan that was dropped or has
 * come all the way round to follow-up is over, so a fresh game can start over it.
 */
export function runInProgress(plan: UiPlan | null): boolean {
  return plan !== null && plan.state !== "dropped" && plan.state !== "followed_up";
}
