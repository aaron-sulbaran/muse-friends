import { describe, expect, it } from "vitest";
import { describeFree, FEELS_MAX, freeChips, freeWindowsFor, MAX_FREE_WINDOWS, mergeWindows, parseFreeText } from "@/lib/ui/free-windows";

// The demo room's clock: Sunday Oct 25, 2 PM Central.
const NOW = "2026-10-25T14:00:00-05:00";
const win = (start: string, end: string) => ({ start, end });

describe("the chips and the windows they stand for", () => {
  it("map tonight, tomorrow evening and Saturday afternoon to the hours on the card, on the room's clock", () => {
    const chips = freeChips(NOW);
    expect(chips.map((chip) => chip.id)).toEqual(["tonight", "tomorrow_evening", "saturday_afternoon"]);
    expect(chips[0].window).toEqual(win("2026-10-25T19:00:00-05:00", "2026-10-25T22:00:00-05:00"));
    expect(chips[1].window).toEqual(win("2026-10-26T18:00:00-05:00", "2026-10-26T21:00:00-05:00"));
    expect(chips[2].window).toEqual(win("2026-10-31T13:00:00-05:00", "2026-10-31T17:00:00-05:00"));
  });

  it("offers Sunday only while this Sunday's window is still ahead: the week the Muses see ends Saturday night", () => {
    expect(freeChips(NOW).some((chip) => chip.id === "sunday")).toBe(false);
    expect(freeChips("2026-10-26T10:00:00-05:00").some((chip) => chip.id === "sunday")).toBe(false);
    const morning = freeChips("2026-10-25T10:00:00-05:00");
    expect(morning.find((chip) => chip.id === "sunday")?.window).toEqual(win("2026-10-25T12:00:00-05:00", "2026-10-25T16:00:00-05:00"));
  });

  it("drops a chip whose window has started, so nothing in the past is ever sent", () => {
    expect(freeChips("2026-10-25T20:00:00-05:00").some((chip) => chip.id === "tonight")).toBe(false);
  });

  it("keeps every chip where the availability route accepts it: ahead, an hour or more, in one day from 9 AM to 10 PM, by Saturday night", () => {
    for (const now of ["2026-10-25T08:00:00-05:00", "2026-10-25T14:00:00-05:00", "2026-10-27T09:00:00-05:00", "2026-10-30T22:00:00-05:00", "2026-10-31T10:00:00-05:00"]) {
      for (const chip of freeChips(now)) {
        const start = Date.parse(chip.window.start);
        const end = Date.parse(chip.window.end);
        expect(start).toBeGreaterThan(Date.parse(now));
        expect(end).toBeLessThanOrEqual(Date.parse("2026-11-01T00:00:00-05:00"));
        expect(end - start).toBeGreaterThanOrEqual(3600_000);
        const startHour = (start - Date.parse(`${chip.window.start.slice(0, 10)}T00:00:00-05:00`)) / 3600_000;
        const endHour = (end - Date.parse(`${chip.window.start.slice(0, 10)}T00:00:00-05:00`)) / 3600_000;
        expect(startHour).toBeGreaterThanOrEqual(9);
        expect(endHour).toBeLessThanOrEqual(22);
      }
    }
  });

  it("drops tomorrow evening on a Saturday, when tomorrow is past the week", () => {
    expect(freeChips("2026-10-31T10:00:00-05:00").map((chip) => chip.id)).toEqual(["tonight", "saturday_afternoon"]);
  });
});

describe("the free-text line", () => {
  const one = (text: string) => parseFreeText(text, NOW);

  it("reads a simple day and hours, with or without minutes and markers", () => {
    expect(one("Tue 6 to 8 PM").windows).toEqual([win("2026-10-27T18:00:00-05:00", "2026-10-27T20:00:00-05:00")]);
    expect(one("Thursday 5:30-7pm").windows).toEqual([win("2026-10-29T17:30:00-05:00", "2026-10-29T19:00:00-05:00")]);
    expect(one("wed 6 to 8").windows).toEqual([win("2026-10-28T18:00:00-05:00", "2026-10-28T20:00:00-05:00")]);
    expect(one("Fri 9 to 11").windows).toEqual([win("2026-10-30T09:00:00-05:00", "2026-10-30T11:00:00-05:00")]);
    expect(one("Mon 11 to 1 PM").windows).toEqual([win("2026-10-26T11:00:00-05:00", "2026-10-26T13:00:00-05:00")]);
  });

  it("reads several, separated by commas or lines", () => {
    expect(one("Tue 6 to 8 PM, Thu 7 to 9 PM\nSat 1 to 4 PM").windows).toHaveLength(3);
  });

  it("names what it cannot read and keeps what it can", () => {
    const result = one("Tue 6 to 8 PM, whenever");
    expect(result.windows).toHaveLength(1);
    expect(result.errors).toEqual(['Could not read "whenever". Try something like "Tue 6 to 8 PM".']);
  });

  it("refuses under an hour, a time that is not one, and a day past the week", () => {
    expect(one("Tue 6 to 6:30 PM").errors[0]).toContain("at least an hour");
    expect(one("Tue 13 to 15").errors[0]).toContain("not a time");
    // Today's name, but the window has gone: the next one is a week on, and that is past Saturday night.
    expect(one("Sun 1 to 3 PM").errors[0]).toContain("already over, or past Saturday night");
    // Outside waking hours, or across a day: the route only takes one day between 9 AM and 10 PM.
    expect(one("Tue 8 to 11 PM").errors[0]).toContain("between 9 AM and 10 PM");
    expect(one("Fri 7 to 9 AM").errors[0]).toContain("between 9 AM and 10 PM");
  });
});

describe("what gets posted", () => {
  it("is the chosen chips and the typed times, in time order, with overlaps joined", () => {
    const result = freeWindowsFor({ chips: ["tomorrow_evening", "tonight"], text: "Mon 8 to 10 PM", feels: "  ramen  " }, NOW);
    expect(result).toEqual({
      ok: true,
      windows: [win("2026-10-25T19:00:00-05:00", "2026-10-25T22:00:00-05:00"), win("2026-10-26T18:00:00-05:00", "2026-10-26T22:00:00-05:00")],
      feels: "ramen",
    });
  });

  it("needs at least one window, and tells a person plainly when it has none", () => {
    expect(freeWindowsFor({ chips: [], text: "", feels: "" }, NOW)).toEqual({ ok: false, message: "Pick at least one time you are free." });
    expect(freeWindowsFor({ chips: [], text: "someday", feels: "" }, NOW).ok).toBe(false);
  });

  it("stops at eight windows and at 120 characters of feeling", () => {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const nine = days.flatMap((day) => [`${day} 10 to 11 AM`, `${day} 1 to 2 PM`]).join(", ");
    const result = freeWindowsFor({ chips: [], text: nine, feels: "" }, "2026-10-25T08:00:00-05:00");
    expect(result).toEqual({ ok: false, message: `That is more than ${MAX_FREE_WINDOWS} windows. Keep the ones that matter.` });
    const long = freeWindowsFor({ chips: ["tonight"], text: "", feels: "x".repeat(300) }, NOW);
    expect(long.ok && long.feels?.length).toBe(FEELS_MAX);
    expect(long.ok && long.feels).toBe("x".repeat(FEELS_MAX));
  });

  it("merges windows that overlap or touch", () => {
    expect(mergeWindows([win("2026-10-26T18:00:00-05:00", "2026-10-26T20:00:00-05:00"), win("2026-10-26T20:00:00-05:00", "2026-10-26T22:00:00-05:00")])).toEqual([win("2026-10-26T18:00:00-05:00", "2026-10-26T22:00:00-05:00")]);
  });
});

describe("the note in the thread", () => {
  it("says the day and the part of it, once each", () => {
    const chips = freeChips(NOW).map((chip) => chip.window);
    expect(describeFree(chips)).toBe("Sun evening, Mon evening, Sat afternoon");
    expect(describeFree([chips[0], chips[0]])).toBe("Sun evening");
  });
});
