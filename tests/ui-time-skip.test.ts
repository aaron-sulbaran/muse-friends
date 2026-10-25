import { describe, expect, it } from "vitest";
import type { PlanState } from "@/lib/protocol";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { viewForRole } from "@/lib/ui/chat";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import { AFTER_SKIP_IDS, SKIP_SEPARATOR_IDS, skipCount, skipDue, skipTarget, skipsByItself, throughSkips } from "@/lib/ui/time-skip";

const at = (state: PlanState) => toUiSnapshot(snapshotAtPlanState(state), { mode: "live" });
const due = (state: PlanState, role: "a" | "b" = "a") => {
  const snapshot = at(state);
  return skipDue(snapshot.plan, viewForRole(snapshot, role).items);
};

describe("the automatic time skip", () => {
  it("is due once the hold row shows, then again once the reminder shows, on both phones", () => {
    for (const role of ["a", "b"] as const) {
      expect(due("scheduled", role)).toBe("scheduled");
      expect(due("reminded", role)).toBe("reminded");
    }
  });

  it("waits for the person to add the hold, then moves from the reminder to the next morning by itself", () => {
    expect(skipsByItself("scheduled")).toBe(false);
    expect(skipsByItself("reminded")).toBe(true);
  });

  it("is never due before the hold, or after the next morning", () => {
    for (const state of ["negotiating", "awaiting_humans", "confirmed", "followed_up", "dropped"] as PlanState[]) expect(due(state)).toBeNull();
  });

  it("names the moment the clock lands on, the same one the lifecycle moves to", () => {
    const plan = at("scheduled").plan!;
    expect(skipTarget(plan, "scheduled")).toEqual({ day: "Tuesday", time: "4:00 PM" });
    expect(skipTarget(plan, "reminded")).toEqual({ day: "Wednesday", time: "10:00 AM" });
    // The skip card the chat draws after the move says the same thing the card before it said.
    const reminded = viewForRole(at("reminded"), "a").items.find((item) => item.id === "sep-reminded");
    expect(reminded).toMatchObject(skipTarget(plan, "scheduled")!);
    const followed = viewForRole(at("followed_up"), "a").items.find((item) => item.id === "sep-followup");
    expect(followed).toMatchObject(skipTarget(plan, "reminded")!);
  });

  it("draws each jump as a skip card with what it skipped to right under it", () => {
    const items = viewForRole(at("followed_up"), "a").items;
    const ids = items.map((item) => item.id);
    for (const id of SKIP_SEPARATOR_IDS) expect(ids).toContain(id);
    expect(ids[ids.indexOf("sep-reminded") + 1]).toBe("reminder");
    expect(ids[ids.indexOf("sep-followup") + 1]).toBe("followup");
    for (const id of ["reminder", "followup"]) expect(AFTER_SKIP_IDS.has(id)).toBe(true);
  });

  it("shows a phone that heard of both skips at once only the first, with its reminder, until the second's turn", () => {
    const items = viewForRole(at("followed_up"), "a").items;
    expect(skipCount(items)).toBe(2);
    const first = throughSkips(items, 1).map((item) => item.id);
    expect(first.slice(-2)).toEqual(["sep-reminded", "reminder"]);
    expect(first).not.toContain("sep-followup");
    expect(first).not.toContain("followup");
    expect(throughSkips(items, 0).map((item) => item.id)).not.toContain("sep-reminded");
    expect(throughSkips(items, 2)).toEqual(items);
    // Before any skip there is nothing to hold back.
    const scheduled = viewForRole(at("scheduled"), "a").items;
    expect(skipCount(scheduled)).toBe(0);
    expect(throughSkips(scheduled, 0)).toEqual(scheduled);
  });
});
