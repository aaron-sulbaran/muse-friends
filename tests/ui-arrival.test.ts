import { describe, expect, it } from "vitest";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { OTHER_SIGNALS } from "@/lib/seed/past-signals";
import { ARRIVAL_AT_MS, ARRIVING_ITEM_IDS, withReelArrival } from "@/lib/ui/arrival";
import { viewForRole } from "@/lib/ui/chat";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import type { UiSnapshot } from "@/lib/ui/types";

const live = { mode: "live" } as const;

/** Michelle on and nothing started: the chat a judge has right after onboarding, before the run. */
function beforeTheRun(): UiSnapshot {
  return { ...toUiSnapshot(snapshotAtPlanState("detected"), live), plan: null, simulatedFriend: true };
}

const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe("the reel's arrival, beat by beat", () => {
  const items = viewForRole(beforeTheRun(), "a").items;

  it("waits on the reel's day, its sender line, the card, and the judge's own reply, and on nothing older", () => {
    expect(ARRIVING_ITEM_IDS.every((id) => ids(items).includes(id))).toBe(true);
    for (const signal of OTHER_SIGNALS) expect(ARRIVING_ITEM_IDS.some((id) => id.includes(signal.id))).toBe(false);
  });

  it("is the whole chat as before when there is no arrival: a reload, the stage, a phone that never ran onboarding", () => {
    expect(withReelArrival(items, null, false)).toBe(items);
  });

  it("starts with the older shares in place and the reel, its reply and the start cards held back", () => {
    const start = ids(withReelArrival(items, 0, false));
    for (const id of ARRIVING_ITEM_IDS) expect(start).not.toContain(id);
    for (const signal of OTHER_SIGNALS) expect(start).toContain(`${signal.id}-line`);
    expect(withReelArrival(items, 0, false).some((item) => item.kind === "start-card" || item.kind === "contact-entry")).toBe(false);
  });

  it("brings the card first (with its day and sender line), then the judge's own reply", () => {
    const card = ids(withReelArrival(items, 1, false));
    expect(card).toEqual(expect.arrayContaining(ARRIVING_ITEM_IDS.slice(0, 3)));
    expect(card).not.toContain(ARRIVING_ITEM_IDS[3]);
    expect(ids(withReelArrival(items, 2, false))).toEqual(expect.arrayContaining([...ARRIVING_ITEM_IDS]));
  });

  it("keeps the chat's order, and lets the start cards go only once there is a plan to replace them", () => {
    const all = ids(withReelArrival(items, 2, false));
    expect(all).toEqual(ids(items).filter((id) => all.includes(id)));
    const withPlan = viewForRole(toUiSnapshot(snapshotAtPlanState("negotiating"), live), "a").items;
    expect(withReelArrival(withPlan, 3, true)).toHaveLength(withReelArrival(withPlan, null, true).length);
  });

  it("times the beats at about 0.8 s, 1.8 s and 2.8 s after Done", () => {
    expect(ARRIVAL_AT_MS).toEqual({ 1: 800, 2: 1800, 3: 2800 });
  });
});
