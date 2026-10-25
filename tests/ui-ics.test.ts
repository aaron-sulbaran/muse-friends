import { describe, expect, it } from "vitest";
import { whatsAppUrl } from "@/lib/ui/handoff";
import { buildHoldIcs } from "@/lib/ui/ics";

const event = {
  uid: "plan-shawarma-01@muse-friends",
  summary: "Shawarma with Lisa",
  window: { start: "2026-10-27T23:00:00Z", end: "2026-10-28T01:00:00Z" },
  stampedAt: "2026-10-25T01:44:00Z",
};

describe("hold.ics", () => {
  const ics = buildHoldIcs(event);

  it("carries UID, DTSTAMP, DTSTART, DTEND in UTC, and SUMMARY", () => {
    expect(ics).toContain("UID:plan-shawarma-01@muse-friends\r\n");
    expect(ics).toContain("DTSTAMP:20261025T014400Z\r\n");
    expect(ics).toContain("DTSTART:20261027T230000Z\r\n");
    expect(ics).toContain("DTEND:20261028T010000Z\r\n");
    expect(ics).toContain("SUMMARY:Shawarma with Lisa\r\n");
  });

  it("uses CRLF line endings throughout", () => {
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("escapes commas, semicolons, and backslashes in the summary", () => {
    const escaped = buildHoldIcs({ ...event, summary: "Dinner, drinks; maybe \\ more" });
    expect(escaped).toContain("SUMMARY:Dinner\\, drinks\\; maybe \\\\ more\r\n");
  });

  it("folds long lines at 75 octets with a leading space on the continuation", () => {
    const folded = buildHoldIcs({ ...event, summary: "x".repeat(200) });
    for (const line of folded.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(folded).toContain("\r\n x");
  });
});

describe("whatsapp handoff", () => {
  it("builds a click-to-chat link with no phone number and the draft encoded", () => {
    expect(whatsAppUrl("hey! tuesday 6 to 8?")).toBe("https://wa.me/?text=hey!%20tuesday%206%20to%208%3F");
  });
});
