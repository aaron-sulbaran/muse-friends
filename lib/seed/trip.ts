import type { MemberId } from "@/lib/protocol";

// Everything here is fictional demo data for the group trip scenario: the three people (two of them played by a
// model), the seeded catalog of flights, stays and excursions, and the trip wallets. Nothing is a real person, a real
// price or a real booking, and every screen that shows any of it says "seeded for the demo". All prices are whole
// dollars per person.

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
  /** The most this person would honestly spend per person on a trip like this. A simulated person never answers above it. */
  ceiling: number;
};

export const TRIP_PEOPLE: Record<MemberId, TripPerson> = {
  aaron: { name: "You", muse: "Sprout", taste: "ramen and film photography", constraint: null, ceiling: 2000 },
  lisa: { name: "Michelle", muse: "Mochi", taste: "food, every cuisine", constraint: null, ceiling: 2000 },
  kai: { name: "Kai", muse: "Pebble", taste: "anime", constraint: "low mobility", ceiling: 1700 },
};

export function isSimulatedMember(value: string): value is SimulatedMember {
  return value === "lisa" || value === "kai";
}

// ---------------------------------------------------------------------------
// The trip
// ---------------------------------------------------------------------------

export const TRIP = {
  title: "Japan trip, July 2027",
  destination: "Tokyo",
  horizonLabel: "July 2027",
  start: "2027-07-10T09:00:00-05:00",
  end: "2027-07-17T20:00:00-05:00",
  /** The group chat that never made it out of the chat, as the starting line of the thread. */
  opener: "We NEED to do Japan next summer.",
  /** The bounded question's range: per person for the whole trip (flights, stay and activities). */
  range: { low: 1600, high: 2000 },
  /** Up-front share of the itinerary total each person puts in the pot. */
  depositPercent: 25,
  /** What each person's seeded trip wallet starts with. Paper dollars on the demo's local ledger. */
  walletStart: 2500,
} as const;

export const SEEDED_LABEL = "Seeded for the demo";

export type CatalogItem = {
  id: string;
  kind: "flight" | "stay" | "excursion";
  label: string;
  cost: number;
  /** What it serves: a taste, or a constraint it satisfies. */
  serves: string[];
  /** How much walking and stairs it asks for. A group with a low-mobility person only takes "low". */
  effort: "low" | "medium" | "high";
};

export const CATALOG: CatalogItem[] = [
  { id: "FL-1", kind: "flight", label: "Austin to Tokyo Haneda, one stop, economy", cost: 860, serves: [], effort: "low" },
  { id: "FL-2", kind: "flight", label: "Austin to Osaka Kansai, one stop, economy", cost: 940, serves: [], effort: "low" },
  { id: "FL-3", kind: "flight", label: "Austin to Tokyo Narita, premium economy", cost: 1180, serves: [], effort: "low" },
  { id: "ST-1", kind: "stay", label: "Shinjuku business hotel, 6 nights, elevator and step-free rooms", cost: 620, serves: ["low mobility"], effort: "low" },
  { id: "ST-2", kind: "stay", label: "Osaka guesthouse, 6 nights, fourth-floor walk-up", cost: 380, serves: [], effort: "high" },
  { id: "ST-3", kind: "stay", label: "Asakusa inn, 6 nights, floor beds and shared stairs", cost: 540, serves: [], effort: "high" },
  { id: "EX-1", kind: "excursion", label: "Akihabara anime day with a seated cafe route", cost: 90, serves: ["anime", "low mobility"], effort: "low" },
  { id: "EX-2", kind: "excursion", label: "Nakano Broadway and a studio museum, many stairs", cost: 75, serves: ["anime"], effort: "high" },
  { id: "EX-3", kind: "excursion", label: "Dotonbori street food crawl, all on foot", cost: 85, serves: ["food"], effort: "high" },
  { id: "EX-4", kind: "excursion", label: "Market breakfast and a seated tasting menu", cost: 110, serves: ["food", "low mobility"], effort: "low" },
  { id: "EX-5", kind: "excursion", label: "Ramen and izakaya evening in Shinjuku, counter seats", cost: 95, serves: ["food", "ramen", "low mobility"], effort: "low" },
  { id: "EX-6", kind: "excursion", label: "Kyoto day trip by train, temple stairs", cost: 140, serves: [], effort: "high" },
  { id: "EX-7", kind: "excursion", label: "Film photography walk through Yanaka's back streets", cost: 60, serves: ["film photography"], effort: "medium" },
];

export function catalogItem(id: string): CatalogItem | undefined {
  return CATALOG.find((item) => item.id === id);
}

/** The source tag a line carries on screen and on the wire. */
export function catalogSource(item: CatalogItem): string {
  return `${SEEDED_LABEL}, catalog ${item.id}`;
}

export const ITINERARY_SHAPE = { flights: 1, stays: 1, excursions: 2 } as const;

/** Whether the group needs low-effort choices only: true when anyone has a mobility limit. */
export function groupNeedsLowEffort(answers: Partial<Record<MemberId, { constraint?: string }>>): boolean {
  return Object.values(answers).some((answer) => /mobility/i.test(answer?.constraint ?? ""));
}
