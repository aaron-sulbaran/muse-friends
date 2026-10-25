import { describe, expect, it } from "vitest";
import {
  describeWindow,
  freeBlocks,
  intersectWindows,
  isSubsetOfBlocks,
  toCentralIso,
  toMs,
  windowHash,
  windowsOverlap,
} from "@/lib/agent/windows";
import type { CalendarEvent } from "@/lib/protocol";
import { CALENDAR_RANGE, PERSONAS } from "@/lib/seed/personas";

const tuesday = { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" };

describe("toCentralIso", () => {
  it("formats epoch milliseconds at UTC-05:00", () => {
    expect(toCentralIso(Date.parse("2026-10-27T23:00:00Z"))).toBe("2026-10-27T18:00:00-05:00");
    expect(toMs("2026-10-27T18:00:00-05:00")).toBe(Date.parse("2026-10-27T23:00:00Z"));
  });
});

describe("freeBlocks", () => {
  const busy = (start: string, end: string): CalendarEvent => ({ id: "x", title: "x", start, end, private: false });
  const day = { start: "2026-10-27T00:00:00-05:00", end: "2026-10-28T00:00:00-05:00" };

  it("returns the waking day when the calendar is empty", () => {
    expect(freeBlocks([], day)).toEqual([{ start: "2026-10-27T09:00:00-05:00", end: "2026-10-27T22:00:00-05:00" }]);
  });

  it("splits around busy events and drops blocks under an hour", () => {
    const blocks = freeBlocks(
      [busy("2026-10-27T10:00:00-05:00", "2026-10-27T12:00:00-05:00"), busy("2026-10-27T12:30:00-05:00", "2026-10-27T21:30:00-05:00")],
      day,
    );
    expect(blocks).toEqual([{ start: "2026-10-27T09:00:00-05:00", end: "2026-10-27T10:00:00-05:00" }]);
  });

  it("clips to the requested range", () => {
    const blocks = freeBlocks([], { start: "2026-10-27T15:00:00-05:00", end: "2026-10-27T17:30:00-05:00" });
    expect(blocks).toEqual([{ start: "2026-10-27T15:00:00-05:00", end: "2026-10-27T17:30:00-05:00" }]);
  });

  it("matches the seeded calendars: Aaron is free Tuesday from 6pm, Lisa from 5pm to 8pm", () => {
    const aaron = freeBlocks(PERSONAS.aaron.calendar, CALENDAR_RANGE);
    const lisa = freeBlocks(PERSONAS.lisa.calendar, CALENDAR_RANGE);
    expect(aaron).toContainEqual({ start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T22:00:00-05:00" });
    expect(lisa).toContainEqual({ start: "2026-10-27T17:00:00-05:00", end: "2026-10-27T20:00:00-05:00" });
  });
});

describe("intersectWindows", () => {
  it("finds Tuesday 6 to 8pm in the seeded calendars", () => {
    const aaron = freeBlocks(PERSONAS.aaron.calendar, CALENDAR_RANGE);
    const lisa = freeBlocks(PERSONAS.lisa.calendar, CALENDAR_RANGE);
    expect(intersectWindows(aaron, lisa)).toContainEqual(tuesday);
  });

  it("drops overlaps shorter than the minimum", () => {
    const a = [{ start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T19:00:00-05:00" }];
    const b = [{ start: "2026-10-27T18:30:00-05:00", end: "2026-10-27T20:00:00-05:00" }];
    expect(intersectWindows(a, b)).toEqual([]);
    expect(intersectWindows(a, b, 30)).toEqual([{ start: "2026-10-27T18:30:00-05:00", end: "2026-10-27T19:00:00-05:00" }]);
  });
});

describe("isSubsetOfBlocks", () => {
  const blocks = [{ start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T22:00:00-05:00" }];

  it("accepts a window inside a block and rejects an invented one", () => {
    expect(isSubsetOfBlocks(tuesday, blocks)).toBe(true);
    expect(isSubsetOfBlocks({ start: "2026-10-27T17:00:00-05:00", end: "2026-10-27T19:00:00-05:00" }, blocks)).toBe(false);
    expect(isSubsetOfBlocks({ start: "2026-10-27T21:00:00-05:00", end: "2026-10-27T23:00:00-05:00" }, blocks)).toBe(false);
  });

  it("does not stitch two adjacent blocks together", () => {
    const split = [
      { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T19:00:00-05:00" },
      { start: "2026-10-27T19:00:00-05:00", end: "2026-10-27T20:00:00-05:00" },
    ];
    expect(isSubsetOfBlocks(tuesday, split)).toBe(false);
  });
});

describe("windowsOverlap and windowHash", () => {
  it("detects overlap but not touching windows", () => {
    expect(windowsOverlap(tuesday, { start: "2026-10-27T19:00:00-05:00", end: "2026-10-27T21:00:00-05:00" })).toBe(true);
    expect(windowsOverlap(tuesday, { start: "2026-10-27T20:00:00-05:00", end: "2026-10-27T21:00:00-05:00" })).toBe(false);
  });

  it("hashes by instant, so the same window in another offset matches", () => {
    expect(windowHash(tuesday)).toBe(windowHash({ start: "2026-10-27T23:00:00Z", end: "2026-10-28T01:00:00Z" }));
    expect(windowHash(tuesday)).not.toBe(windowHash({ start: tuesday.start, end: "2026-10-27T21:00:00-05:00" }));
    expect(windowHash(tuesday)).toMatch(/^w_[0-9a-f]{8}$/);
  });
});

describe("describeWindow", () => {
  it("reads like a person would say it", () => {
    expect(describeWindow(tuesday)).toBe("Tue 6 to 8pm");
    expect(describeWindow({ start: "2026-10-28T18:00:00-05:00", end: "2026-10-28T19:30:00-05:00" })).toBe("Wed 6 to 7:30pm");
    expect(describeWindow({ start: "2026-10-30T11:00:00-05:00", end: "2026-10-30T13:00:00-05:00" })).toBe("Fri 11am to 1pm");
  });
});
