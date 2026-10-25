import type { TimeWindow } from "./types";

/** 20261027T230000Z, the UTC form Google Calendar's template link expects. */
function utc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export type GoogleEventInput = {
  title: string;
  window: TimeWindow;
  details: string;
  /** Omitted from the link when the place was withheld by policy, so the prefilled event never carries it. */
  location: string | null;
};

/**
 * A prefilled "new event" link for Google Calendar. No sign-in and no integration: a person with Google on
 * their phone lands in a draft event and presses save. The .ics download stays as the other route.
 */
export function googleCalendarUrl(input: GoogleEventInput): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.title,
    dates: `${utc(input.window.start)}/${utc(input.window.end)}`,
    details: input.details,
  });
  if (input.location) params.set("location", input.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
