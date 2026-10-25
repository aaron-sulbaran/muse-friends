import { describe, expect, it } from "vitest";
import { googleCalendarUrl } from "@/lib/ui/gcal";

const window = { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" };
const input = { title: "Shawarma Point with Mochi", window, details: "Sprout and Mochi planned this in Muse Friends.", location: "E 6th St, Austin" };

describe("google calendar link", () => {
  const url = new URL(googleCalendarUrl(input));

  it("is a prefilled new-event template on calendar.google.com, with no sign-in step", () => {
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
  });

  it("carries the title, details, and location as given", () => {
    expect(url.searchParams.get("text")).toBe("Shawarma Point with Mochi");
    expect(url.searchParams.get("details")).toBe("Sprout and Mochi planned this in Muse Friends.");
    expect(url.searchParams.get("location")).toBe("E 6th St, Austin");
  });

  it("writes the dates in UTC, matching the .ics", () => {
    expect(url.searchParams.get("dates")).toBe("20261027T230000Z/20261028T010000Z");
  });

  it("leaves the location out entirely when the place was withheld", () => {
    const withheld = new URL(googleCalendarUrl({ ...input, location: null }));
    expect(withheld.searchParams.has("location")).toBe(false);
    expect(withheld.toString()).not.toContain("6th");
  });

  it("encodes characters that would break a query string", () => {
    const tricky = new URL(googleCalendarUrl({ ...input, title: "Coffee & cake, 50% off?" }));
    expect(tricky.searchParams.get("text")).toBe("Coffee & cake, 50% off?");
  });
});
