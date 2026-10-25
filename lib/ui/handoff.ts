/**
 * WhatsApp click-to-chat with no phone number: the person picks the contact and
 * presses send, so nothing is stored and the agent never sends on its own.
 */
export function whatsAppUrl(draft: string): string {
  return `https://wa.me/?text=${encodeURIComponent(draft)}`;
}

/** The custom green check (public/marks): what a done action shows, in the status-glyph style, never an emoji. */
export const CHECK_MARK_SRC = "/marks/check.svg";

/** Which way the calendar hold was taken: the .ics download or the Google Calendar link. */
export type CalendarRoute = "ics" | "google";
