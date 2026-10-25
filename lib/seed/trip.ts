import type { MemberId } from "@/lib/protocol";

// Everything here is fictional demo data for the group scenario: the two people a model plays, and (later in
// this file) the seeded trip catalog. Nothing is a real person, a real price or a real booking, and the screens
// that show any of it say "seeded for the demo".

/** The group's members a model can play. Sprout's person is the judge, so Sprout is never simulated. */
export type SimulatedMember = Exclude<MemberId, "aaron">;

export type TripPerson = {
  /** What the group calls the person (the Muse has its own name in the personas). */
  name: string;
  /** The person's Muse, as it is named on screen. */
  muse: string;
  /** What this person likes, in their own words: the taste the coordinator balances. */
  taste: string;
  /** A practical limit the plan has to respect, or null. */
  constraint: string | null;
};

export const TRIP_PEOPLE: Record<SimulatedMember, TripPerson> = {
  lisa: { name: "Michelle", muse: "Mochi", taste: "food, every cuisine", constraint: null },
  kai: { name: "Kai", muse: "Pebble", taste: "anime", constraint: "low mobility" },
};

export function isSimulatedMember(value: string): value is SimulatedMember {
  return value === "lisa" || value === "kai";
}
