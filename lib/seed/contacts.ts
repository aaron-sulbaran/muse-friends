import { z } from "zod";
import { AgentId, ShareTier } from "@/lib/protocol";

// People the user has met but is not close to. Fictional and seeded. The user names the contact they
// want to follow up with; nothing here is ever picked by an agent.

export const Contact = z.strictObject({
  id: z.string().min(1).max(40),
  displayName: z.string().min(1).max(40),
  // One line for the picker and the agent's brief.
  howYouMet: z.string().min(1).max(120),
  // How much the user shares with this person.
  tier: ShareTier,
  // The follow graph. A thread starts only if both are true.
  youFollow: z.boolean(),
  followsYou: z.boolean(),
  // Which seeded agent plays this contact's Muse (the demo has two agents).
  agent: AgentId,
});
export type Contact = z.infer<typeof Contact>;

export const CONTACTS: Contact[] = [
  {
    id: "jules",
    displayName: "Jules",
    howYouMet: "Met at a concert last week and followed each other afterwards",
    tier: "acquaintance",
    youFollow: true,
    followsYou: true,
    agent: "lisa",
  },
  {
    id: "riley",
    displayName: "Riley",
    howYouMet: "Was at the same concert last week and followed you; you have not followed back",
    tier: "acquaintance",
    youFollow: false,
    followsYou: true,
    agent: "lisa",
  },
];

export function getContact(id: string): Contact | undefined {
  return CONTACTS.find((contact) => contact.id === id);
}

export const isMutual = (contact: Pick<Contact, "youFollow" | "followsYou">) => contact.youFollow && contact.followsYou;
