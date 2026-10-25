import type { UiContact } from "./types";

/*
 * The people on the "Follow up with someone you met" list. PLACEHOLDER: until
 * Lane A's seed names the real contacts, this fixture stands in (fictional
 * names, no real people). The snapshot adapter is the only reader, so swapping
 * in the seed is a one-function change.
 */
export const fixtureContacts: UiContact[] = [
  { id: "lisa", name: "Mochi", tier: "friend", mutualFollow: true, note: "Your usual shawarma partner" },
  { id: "juno", name: "Juno", tier: "acquaintance", mutualFollow: true, note: "Met at a concert last month" },
  { id: "pax", name: "Pax", tier: "acquaintance", mutualFollow: false, note: "Chatted once at a meetup" },
];

export const tierLabel: Record<UiContact["tier"], string> = { friend: "friend", acquaintance: "acquaintance" };

/** The mutual-follow mark: the one fact the gate checks, said in words. */
export function followMark(contact: UiContact): string {
  return contact.mutualFollow ? "Follows each other" : "Doesn't follow back";
}
