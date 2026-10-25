/**
 * WhatsApp click-to-chat with no phone number: the person picks the contact and
 * presses send, so nothing is stored and the agent never sends on its own.
 */
export function whatsAppUrl(draft: string): string {
  return `https://wa.me/?text=${encodeURIComponent(draft)}`;
}
