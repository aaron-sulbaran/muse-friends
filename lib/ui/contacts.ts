import type { ShareTier, UiContact } from "./types";

export const tierLabel: Record<ShareTier, string> = { close: "close friend", friend: "friend", acquaintance: "acquaintance", off: "off" };

/** The follow graph in words: the one fact the start gate checks, and which side of it is missing. */
export function followMark(contact: Pick<UiContact, "youFollow" | "followsYou">): string {
  if (contact.youFollow && contact.followsYou) return "Follows each other";
  if (contact.followsYou) return "Follows you, you don't follow back";
  if (contact.youFollow) return "You follow, doesn't follow back";
  return "Not connected";
}
