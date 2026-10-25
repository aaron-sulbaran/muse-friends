import { describe, expect, it } from "vitest";
import {
  daySeparatorFor,
  formatClockLabel,
  formatStatusBarTime,
  formatWindow,
  formatWindowFull,
  formatWindowList,
  formatWindowSpoken,
  messageAccessibleName,
  messageTitle,
  policyStampFor,
} from "@/lib/ui/format";
import type { UiMessage } from "@/lib/ui/types";

const tuesday = { start: "2026-10-27T23:00:00Z", end: "2026-10-28T01:00:00Z" }; // Tue 6 to 8 PM Central
const thursday = { start: "2026-10-30T00:00:00Z", end: "2026-10-30T02:00:00Z" }; // Thu 7 to 9 PM Central

function message(overrides: Partial<UiMessage>): UiMessage {
  return {
    id: "m1",
    contextId: "c1",
    seq: 1,
    from: "aaron",
    to: "lisa",
    type: "intent",
    state: "working",
    reason: "interest_match",
    shared: [],
    removed: [],
    at: "2026-10-25T01:42:10Z",
    raw: {},
    ...overrides,
  };
}

describe("window formatting", () => {
  it("writes Central times, dropping minutes on the hour", () => {
    expect(formatWindow(tuesday)).toBe("Tue 6 to 8 PM");
    expect(formatWindowFull(tuesday)).toBe("Tue, Oct 27, 6 to 8 PM");
    expect(formatWindowSpoken(tuesday)).toBe("Tuesday 6 to 8");
  });

  it("keeps minutes and both meridiems when the window crosses noon", () => {
    expect(formatWindow({ start: "2026-10-27T16:30:00Z", end: "2026-10-27T18:00:00Z" })).toBe("Tue 11:30 AM to 1 PM");
  });

  it("joins several windows", () => {
    expect(formatWindowList([tuesday, thursday])).toBe("Tue 6 to 8 PM and Thu 7 to 9 PM");
  });
});

describe("clock formatting", () => {
  it("formats the status bar and the simulated clock label in Central", () => {
    expect(formatStatusBarTime("2026-10-25T01:44:00Z")).toBe("8:44");
    expect(formatClockLabel("2026-10-25T01:44:00Z")).toBe("Sat 8:44 PM");
  });

  it("names the day relative to now for chat separators", () => {
    const now = "2026-10-25T01:44:00Z";
    expect(daySeparatorFor("2026-10-25T01:41:00Z", now)).toEqual({ day: "Today", time: "8:41 PM" });
    expect(daySeparatorFor("2026-10-23T14:00:00Z", now)).toEqual({ day: "Yesterday", time: "9:00 AM" });
    expect(daySeparatorFor("2026-10-27T22:00:00Z", now)).toEqual({ day: "Tuesday", time: "5:00 PM" });
  });
});

describe("activity titles", () => {
  it("writes past tense from type and fields", () => {
    expect(messageTitle(message({ type: "intent", activity: { title: "Shawarma Point" } }), false)).toBe("Asked about Shawarma Point");
    expect(messageTitle(message({ type: "propose", windows: [tuesday, thursday] }), false)).toBe(
      "Proposed Tue 6 to 8 PM and Thu 7 to 9 PM",
    );
    expect(messageTitle(message({ type: "counter", windows: [tuesday] }), false)).toBe("Countered with Tue 6 to 8 PM");
    expect(messageTitle(message({ type: "accept", windows: [tuesday] }), false)).toBe("Accepted Tue 6 to 8 PM");
    expect(messageTitle(message({ type: "decline", reason: "no_overlap" }), false)).toBe("Declined: no time works");
  });
});

describe("policy stamp", () => {
  it("lists what crossed and what was withheld", () => {
    const stamp = policyStampFor(message({ type: "propose", windows: [tuesday], shared: ["food", "location"], removed: [] }));
    expect(stamp).toEqual({ shared: "food, location, and times", withheld: null });
    expect(policyStampFor(message({ shared: ["food"], removed: ["location"] }))).toEqual({ shared: "food", withheld: "location" });
  });

  it("never omits the stamp: a message that shared nothing says so", () => {
    expect(policyStampFor(message({ type: "intent", shared: [], removed: [] }))).toEqual({ shared: "nothing", withheld: null });
  });

  it("reads the whole row to a screen reader", () => {
    const row = message({ type: "propose", windows: [tuesday], shared: ["food"], removed: ["location"] });
    expect(messageAccessibleName(row, false)).toBe(
      "Sprout to Mochi, propose, Proposed Tue 6 to 8 PM, shared food and times, withheld location",
    );
  });

  it("names the simulated friend instead of Mochi", () => {
    expect(messageAccessibleName(message({ from: "lisa", to: "aaron", type: "accept", windows: [tuesday] }), true)).toContain(
      "Michelle's Muse to Sprout",
    );
  });
});
