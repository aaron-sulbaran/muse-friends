import { describe, expect, it } from "vitest";
import { PLAN_STATES } from "@/lib/protocol";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { goalRowDetail, goalSteps, goalTitle, isTracked, stepLabel } from "@/lib/ui/goals";
import { toUiSnapshot } from "@/lib/ui/snapshot";

const ctx = { friend: "Mochi", reelOwner: "Mochi's", muses: ["Sprout", "Mochi"] as [string, string] };
const at = (state: (typeof PLAN_STATES)[number]) => toUiSnapshot(snapshotAtPlanState(state), { mode: "live" }).plan!;

describe("the plan as a Goals item", () => {
  it("is tracked from confirmed through the follow-up, and not before or after a drop", () => {
    const tracked = PLAN_STATES.filter((state) => isTracked(at(state)));
    expect(tracked).toEqual(["confirmed", "scheduled", "reminded", "happened", "followed_up"]);
  });

  it("titles the goal with the activity and the friend", () => {
    expect(goalTitle(at("scheduled"), "Mochi")).toBe("Shawarma Point with Mochi");
  });

  it("uses the spec's labels for the lifecycle", () => {
    expect(PLAN_STATES.filter((state) => state !== "dropped").map(stepLabel)).toEqual([
      "Found",
      "Talking",
      "Your call",
      "Confirmed",
      "On calendar",
      "Reminded",
      "Happened",
      "Made it?",
    ]);
  });

  it("has one timeline step per state reached, with the spec's details", () => {
    const steps = goalSteps(at("followed_up"), ctx);
    expect(steps.map((step) => step.label)).toEqual(["Found", "Talking", "Your call", "Confirmed", "On calendar", "Reminded", "Happened", "Done"]);
    expect(steps[0].detail).toBe("From Mochi's reel");
    expect(steps[1].detail).toBe("Sprout and Mochi are comparing times");
    expect(steps[2].detail).toBe("Waiting for you and Mochi");
    expect(steps[3].detail).toBe("You both said yes");
    expect(steps[4].detail).toBe("Tue 6 to 8 PM");
    expect(steps[5].detail).toMatch(/^Tuesday 4:00 PM$/);
    expect(steps[7].detail).toBe("You two made it");
    expect(steps.every((step) => /^\d{1,2}:\d{2} (AM|PM)$/.test(step.time))).toBe(true);
  });

  it("says whose reel it was from this phone's side", () => {
    expect(goalSteps(at("confirmed"), { ...ctx, reelOwner: "your" })[0].detail).toBe("From your reel");
  });

  it("the row's detail follows the plan and says when the hold is on the calendar", () => {
    expect(goalRowDetail(at("confirmed"), ctx)).toBe("You both said yes");
    expect(goalRowDetail(at("scheduled"), ctx)).toBe("Tue 6 to 8 PM, hold added");
    expect(goalRowDetail(at("followed_up"), ctx)).toBe("You two made it");
  });

  it("a dropped plan's last step says why", () => {
    const steps = goalSteps(at("dropped"), ctx);
    expect(steps.at(-1)).toMatchObject({ label: "Dropped", detail: "A person said not now" });
  });
});
