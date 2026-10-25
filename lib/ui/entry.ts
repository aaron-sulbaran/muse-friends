import type { UiPlan, UiSnapshot } from "./types";

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

/** The tab remembers it has seen Michelle on in a room, so a reload after the Invite sheet turned her off never turns her back on. */
const michelleSeenKey = (room: string) => `muse-friends:michelle-seen:${room}`;

export function wasMichelleSeen(room: string): boolean {
  try {
    return sessionStorage.getItem(michelleSeenKey(room)) === "1";
  } catch {
    return false;
  }
}

export function markMichelleSeen(room: string): void {
  try {
    sessionStorage.setItem(michelleSeenKey(room), "1");
  } catch {
    // Storage can be blocked: the worst case is that Michelle is offered once more on a reload.
  }
}

/**
 * A phone room with no plan and no simulated friend, in a tab that has not seen her on, turns Michelle on at first
 * load, so a judge lands on the reel with Sprout already reading it (D24: Michelle is the default on a phone). A
 * stopgap for rooms created without her: the proper default is for a new room to start with her on.
 */
export function needsMichelleOnLoad(snapshot: Pick<UiSnapshot, "plan" | "simulatedFriend">, seenInThisTab: boolean): boolean {
  return snapshot.plan === null && !snapshot.simulatedFriend && !seenInThisTab;
}
