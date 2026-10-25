import { SEEDED_FRIENDS, type SeededFriend } from "@/lib/seed/friends";
import { onboardingCopy } from "./copy";
import type { OnboardingState } from "./onboarding";
import type { ShareTier, UiSnapshot } from "./types";

/*
 * What the onboarding flow decides, as pure functions: which sheet is open, who the plan is with, what Continue
 * starts, the "Friends is on" indicator, and when a phone skips onboarding altogether. The screen only reads these
 * and calls the network; the rules are tested here.
 */

export type PickerMode = "choose" | "synced" | "pick";

/** The friend the plan is with: the first seeded friend whose Muse can take part (Michelle, with Mochi). */
export const ROOM_FRIEND: SeededFriend = (() => {
  const friend = SEEDED_FRIENDS.find((candidate) => candidate.museModel !== null);
  if (!friend) throw new Error("the seeded friends need one with a Muse");
  return friend;
})();

/** Which list the who sheet shows, or null when that sheet is not open. */
export function pickerMode(state: OnboardingState): PickerMode | null {
  if (state.step !== "who") return null;
  return state.source === "sync" ? "synced" : state.source === "pick" ? "pick" : "choose";
}

/** The friend the share sheet is about, or null when that sheet is not open. */
export function shareFriend(state: OnboardingState): SeededFriend | null {
  return state.step === "share" ? ROOM_FRIEND : null;
}

/** The tier the judge gave the room's friend. */
export function roomFriendTier(state: OnboardingState): ShareTier {
  return state.tiers[ROOM_FRIEND.id] ?? "off";
}

/**
 * What Continue writes: the tier for the judge's own Muse, with the simulated friend switched on. Null when the room's
 * friend is at Off, because nothing can start without her. The run itself starts at Done, with the reel's arrival.
 */
export function startRequest(state: OnboardingState): { tier: Exclude<ShareTier, "off"> } | null {
  const tier = roomFriendTier(state);
  return tier === "off" ? null : { tier };
}

/** Done on the share step starts the reel's arrival and then the run, only for a room whose friend can take part. */
export function startsRunAtDone(state: OnboardingState): boolean {
  return state.friendsOn && roomFriendTier(state) !== "off";
}

/** The persistent indicator on the avatar sheet's shield: shown while Friends is on, never after an opt-out. */
export function friendsIndicator(state: OnboardingState): string | null {
  return state.friendsOn ? onboardingCopy.friendsIsOn : null;
}

export const ONBOARDING_PARAM = "onboarding";

/** The presenter's stage and tests skip onboarding with ?onboarding=off. */
export function onboardingBypassed(search: string): boolean {
  return new URLSearchParams(search).get(ONBOARDING_PARAM) === "off";
}

/** A phone room with no plan and no simulated friend turns Michelle on at first load, so the judge lands on the reel. */
export function needsMichelleOnLoad(snapshot: Pick<UiSnapshot, "plan" | "simulatedFriend">): boolean {
  return snapshot.plan === null && !snapshot.simulatedFriend;
}
