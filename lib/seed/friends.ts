/*
 * The friends the demo onboarding lists. Fictional and fixed: nothing here is read from Instagram or from the judge
 * (the "Sync" row says so on screen). Only names, initials and one fact line live here, so this file is safe in a
 * browser bundle, unlike the seed calendars.
 */

export type SeededFriend = {
  id: string;
  name: string;
  /** The letter on the person's grey disc. People are never drawn as Muses. */
  initial: string;
  /** One line under the name. It orders the list and never sets a tier. */
  fact: string;
  /** True when the seeded Instagram Close Friends list has this person on it (what "Sync" brings in). */
  onInstagramCloseFriends: boolean;
  /** The friend's Muse, when it has art and a model behind it; null shows the disc alone. */
  museModel: "mochi" | null;
};

/** Michelle first: she is the room's friend, the one who sent the reel, and the only one with a Muse to talk to. */
export const SEEDED_FRIENDS: ReadonlyArray<SeededFriend> = [
  { id: "michelle", name: "Michelle", initial: "M", fact: "Sent you a reel today", onInstagramCloseFriends: true, museModel: "mochi" },
  { id: "priya", name: "Priya", initial: "P", fact: "On your Instagram Close Friends", onInstagramCloseFriends: true, museModel: null },
];

export const SEEDED_FRIEND_IDS: ReadonlyArray<string> = SEEDED_FRIENDS.map((friend) => friend.id);
