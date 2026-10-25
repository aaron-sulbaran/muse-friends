/*
 * What the two people already shared in their chat before Muse Friends picked anything up. All of it is
 * fictional. The shawarma reel is the plan the demo makes happen; the others are plans that died in the
 * chat too, and Muse picks the next idea from them once the first one actually happened.
 * Pure data with no persona calendars, so it is safe in a browser bundle.
 */

export type PastSignal = {
  id: string;
  kind: "reel" | "place";
  /** How long before the plan's day it was shared. */
  daysAgo: number;
  /** Clock time it was shared, as the chat separator shows it. */
  time: string;
  /** What it is about, short: the place or the trip. */
  title: string;
  /** Fictional poster handle, for a reel. */
  poster?: string;
  /** Fictional caption, for a reel. */
  caption?: string;
  /** Under `public/`, for a reel's 9:16 thumbnail. */
  image?: string;
  /** The reel's address. An instagram.com reel address shows as Instagram's embed; anything else keeps the card. */
  permalink?: string;
  /** The friend's side of the share, read by side a ("Michelle sent you ..."). */
  sentLine: (friend: string) => string;
  /** The same share as side b sees it. */
  sentLineMine: (friend: string) => string;
  /** What the person said back at the time, and never followed up on. */
  reply: string;
  /** What Muse says when it surfaces this as the next idea, on side a (the friend shared it). */
  nextIdea: (friend: string) => string;
  /** The same, on side b (this person shared it). */
  nextIdeaMine: (friend: string) => string;
};

export const SHAWARMA_REEL: PastSignal = {
  id: "reel_shawarma_point",
  kind: "reel",
  daysAgo: 7,
  time: "7:42 PM",
  title: "Shawarma Point",
  poster: "eastside.eats.atx",
  caption: "the garlic sauce at Shawarma Point should be illegal 🧄🔥",
  image: "/reels/shawarma-point.jpg",
  // The same address as the seeded signal in lib/seed/fixtures.ts (a test holds them equal), so the reel on
  // screen is the reel the agents read. Set both to the reel Aaron or Lisa owns.
  permalink: "https://example.com/reel/seed-shawarma-001",
  sentLine: (friend) => `${friend} sent you a reel. 🎞️`,
  sentLineMine: (friend) => `You sent ${friend} a reel. 🎞️`,
  reply: "we should go!",
  nextIdea: (friend) => `${friend} sent you this a week ago. Want me to see if you two can make it happen?`,
  nextIdeaMine: (friend) => `You sent ${friend} this a week ago. I'm checking if you two can make it happen.`,
};

/** The other plans still sitting in the chat, oldest first. Muse picks the next idea from these. */
export const OTHER_SIGNALS: PastSignal[] = [
  {
    id: "place_cedar_bluff",
    kind: "place",
    daysAgo: 33,
    time: "11:05 AM",
    title: "Cedar Bluff Trail",
    sentLine: (friend) => `${friend} sent you a hiking spot: Cedar Bluff Trail. 🥾`,
    sentLineMine: (friend) => `You sent ${friend} a hiking spot: Cedar Bluff Trail. 🥾`,
    reply: "omg yes, when it cools down",
    nextIdea: (friend) => `${friend} also sent you a hiking spot last month, Cedar Bluff Trail. Want me to check with ${friend}?`,
    nextIdeaMine: (friend) => `You also sent ${friend} a hiking spot last month, Cedar Bluff Trail. Want me to check with ${friend}?`,
  },
  {
    id: "reel_cabin_weekend",
    kind: "reel",
    daysAgo: 16,
    time: "9:18 PM",
    title: "Hill Country cabin",
    poster: "slowweekends.tx",
    caption: "48 hours, one cabin, zero signal 🌲",
    image: "/reels/cabin-weekend.jpg",
    sentLine: (friend) => `${friend} sent you a reel. 🎞️`,
    sentLineMine: (friend) => `You sent ${friend} a reel. 🎞️`,
    reply: "we need to do this",
    nextIdea: (friend) => `${friend} also sent you a Hill Country cabin weekend a couple of weeks ago. Want me to look for a free weekend with ${friend}?`,
    nextIdeaMine: (friend) => `You also sent ${friend} a Hill Country cabin weekend a couple of weeks ago. Want me to look for a free weekend with ${friend}?`,
  },
];

export function pastSignal(id: string): PastSignal | undefined {
  return [SHAWARMA_REEL, ...OTHER_SIGNALS].find((signal) => signal.id === id);
}
