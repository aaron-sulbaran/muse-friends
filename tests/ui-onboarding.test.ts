import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEEDED_FRIEND_IDS } from "@/lib/seed/friends";
import { displayName, initialOnboarding, loadOnboarding, reduceOnboarding, saveOnboarding, type OnboardingAction, type OnboardingState } from "@/lib/ui/onboarding";

const run = (actions: OnboardingAction[], from: OnboardingState = initialOnboarding()) => actions.reduce(reduceOnboarding, from);

/** sessionStorage for a node test: a Map with the same four calls the module uses. */
function stubSessionStorage() {
  const items = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  });
  return items;
}

beforeEach(() => void stubSessionStorage());
afterEach(() => vi.unstubAllGlobals());

describe("the onboarding steps", () => {
  it("starts at name with Friends off and nobody above Off", () => {
    const state = initialOnboarding();
    expect(state).toMatchObject({ step: "name", friendsOn: false });
    expect(Object.keys(state.tiers)).toEqual([...SEEDED_FRIEND_IDS]);
    expect(Object.values(state.tiers).every((tier) => tier === "off")).toBe(true);
  });

  it("starts at name and a Not now goes to done with Friends off", () => {
    const state = reduceOnboarding(initialOnboarding(), { type: "notNow" });
    expect(state.step).toBe("done");
    expect(state.friendsOn).toBe(false);
  });

  it("turning Friends on opens the who step, and a Not now there behaves like the opt-out", () => {
    const on = run([{ type: "friendsOn" }]);
    expect(on).toMatchObject({ step: "who", friendsOn: true, source: "none" });
    expect(reduceOnboarding(on, { type: "notNow" })).toMatchObject({ step: "done", friendsOn: false });
  });

  it("sync sets every seeded friend to close and continue goes to share", () => {
    const synced = run([{ type: "friendsOn" }, { type: "sync" }]);
    expect(Object.values(synced.tiers).every((tier) => tier === "close")).toBe(true);
    expect(synced.source).toBe("sync");
    expect(reduceOnboarding(synced, { type: "continue" }).step).toBe("share");
  });

  it("pick starts everyone at off, and continue with nobody above off behaves like the opt-out", () => {
    const picked = run([{ type: "friendsOn" }, { type: "pick" }]);
    expect(Object.values(picked.tiers).every((tier) => tier === "off")).toBe(true);
    expect(picked.source).toBe("pick");
    const continued = reduceOnboarding(picked, { type: "continue" });
    expect(continued.step).toBe("done");
    expect(continued.friendsOn).toBe(false);
  });

  it("a tier tap changes one friend only, and continue then goes to share", () => {
    const state = run([{ type: "friendsOn" }, { type: "pick" }, { type: "tier", friendId: "michelle", tier: "friend" }]);
    expect(state.tiers).toMatchObject({ michelle: "friend", priya: "off" });
    expect(reduceOnboarding(state, { type: "continue" }).step).toBe("share");
  });

  it("treats a Continue with only a friend who has no Muse above Off as the opt-out, since nobody can take part", () => {
    const state = run([{ type: "friendsOn" }, { type: "pick" }, { type: "tier", friendId: "priya", tier: "close" }, { type: "continue" }]);
    expect(state).toMatchObject({ step: "done", friendsOn: false });
  });

  it("goes to share when the room's friend is above Off, whoever else is", () => {
    const state = run([{ type: "friendsOn" }, { type: "pick" }, { type: "tier", friendId: "michelle", tier: "friend" }, { type: "continue" }]);
    expect(state.step).toBe("share");
  });

  it("ignores a tier for a friend it does not list", () => {
    const state = run([{ type: "friendsOn" }, { type: "pick" }]);
    expect(reduceOnboarding(state, { type: "tier", friendId: "nobody", tier: "close" })).toEqual(state);
  });

  it("back from share returns to who with the choices kept, and back from a list returns to the choice", () => {
    const share = run([{ type: "friendsOn" }, { type: "sync" }, { type: "continue" }]);
    const who = reduceOnboarding(share, { type: "back" });
    expect(who).toMatchObject({ step: "who", source: "sync" });
    expect(Object.values(who.tiers).every((tier) => tier === "close")).toBe(true);
    const choice = reduceOnboarding(who, { type: "back" });
    expect(choice).toMatchObject({ step: "who", source: "none" });
    expect(Object.values(choice.tiers).every((tier) => tier === "off")).toBe(true);
  });

  it("done keeps Friends on", () => {
    const state = run([{ type: "friendsOn" }, { type: "sync" }, { type: "continue" }, { type: "done" }]);
    expect(state).toMatchObject({ step: "done", friendsOn: true });
  });

  it("ignores an action that does not belong to the current step", () => {
    const state = initialOnboarding();
    expect(reduceOnboarding(state, { type: "sync" })).toEqual(state);
    expect(reduceOnboarding(state, { type: "continue" })).toEqual(state);
    const finished = run([{ type: "notNow" }]);
    expect(reduceOnboarding(finished, { type: "friendsOn" })).toMatchObject({ step: "who", friendsOn: true });
    expect(reduceOnboarding(finished, { type: "done" })).toEqual(finished);
  });
});

describe("the name", () => {
  it("displays as you when empty or blank, and as the trimmed name otherwise", () => {
    expect(displayName(initialOnboarding())).toBe("you");
    expect(displayName(run([{ type: "name", name: "   " }]))).toBe("you");
    expect(displayName(run([{ type: "name", name: " Jordan " }]))).toBe("Jordan");
  });

  it("keeps what is typed, spaces and all, up to a short limit", () => {
    expect(run([{ type: "name", name: "Mary " }]).name).toBe("Mary ");
    expect(run([{ type: "name", name: "x".repeat(60) }]).name).toHaveLength(24);
  });
});

describe("a reload on the same room", () => {
  it("resumes the same step with the same name, and a new room starts over", () => {
    const state = run([{ type: "name", name: " Jordan " }, { type: "friendsOn" }, { type: "pick" }, { type: "tier", friendId: "michelle", tier: "close" }]);
    saveOnboarding("r1", state);
    const resumed = loadOnboarding("r1");
    expect(resumed).toMatchObject({ step: "who", name: "Jordan", friendsOn: true, source: "pick" });
    expect(resumed.tiers.michelle).toBe("close");
    expect(loadOnboarding("r2").step).toBe("name");
  });

  it("starts over when what is stored is not an onboarding state", () => {
    const items = stubSessionStorage();
    items.set("muse-friends:onboarding:r1", "{not json");
    expect(loadOnboarding("r1")).toEqual(initialOnboarding());
    items.set("muse-friends:onboarding:r1", JSON.stringify({ step: "space", name: 4 }));
    expect(loadOnboarding("r1")).toEqual(initialOnboarding());
  });

  it("starts over, and does not throw, when storage is blocked", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadOnboarding("r1")).toEqual(initialOnboarding());
    expect(() => saveOnboarding("r1", initialOnboarding())).not.toThrow();
  });

  it("starts over when there is no storage at all, as on the server", () => {
    vi.unstubAllGlobals();
    expect(loadOnboarding("r1")).toEqual(initialOnboarding());
    expect(() => saveOnboarding("r1", initialOnboarding())).not.toThrow();
  });
});

describe("the free step (when you are free this week)", () => {
  const atShare = () => run([{ type: "friendsOn" }, { type: "sync" }, { type: "continue" }]);
  const atFreeA = () => run([{ type: "free" }], atShare());
  const atFreeB = () => run([{ type: "name", name: "Jordan" }, { type: "free" }]);

  it("comes after share on side a, and after the name on side b", () => {
    expect(atFreeA().step).toBe("free");
    expect(atFreeB()).toMatchObject({ step: "free", name: "Jordan" });
  });

  it("does not start from any other step", () => {
    expect(run([{ type: "free" }], run([{ type: "friendsOn" }])).step).toBe("who");
    expect(run([{ type: "free" }], run([{ type: "notNow" }])).step).toBe("done");
  });

  it("keeps the chips, the typed times and the feeling, and a second tap on a chip takes it back", () => {
    const state = run([{ type: "chip", id: "tonight" }, { type: "chip", id: "saturday_afternoon" }, { type: "chip", id: "tonight" }, { type: "freeText", text: "Tue 6 to 8 PM" }, { type: "feels", text: "ramen" }], atFreeA());
    expect(state.free).toEqual({ chips: ["saturday_afternoon"], text: "Tue 6 to 8 PM", feels: "ramen" });
  });

  it("limits what it keeps: 120 characters of feeling, 160 of typed times", () => {
    const state = run([{ type: "freeText", text: "x".repeat(400) }, { type: "feels", text: "y".repeat(400) }], atFreeB());
    expect(state.free.text).toHaveLength(160);
    expect(state.free.feels).toHaveLength(120);
  });

  it("ignores its answers anywhere else, so a stray tap cannot write them", () => {
    expect(run([{ type: "chip", id: "tonight" }, { type: "feels", text: "hi" }], atShare()).free).toEqual({ chips: [], text: "", feels: "" });
  });

  it("finishes with Done, or with a skip that is the same step: onboarding is over, with nothing else changed", () => {
    expect(run([{ type: "done" }], atFreeA())).toMatchObject({ step: "done", friendsOn: true });
    expect(run([{ type: "done" }], atFreeB()).step).toBe("done");
  });

  it("goes back to the share sheet on side a and to the name on side b", () => {
    expect(run([{ type: "back" }], atFreeA()).step).toBe("share");
    expect(run([{ type: "back" }], atFreeB()).step).toBe("name");
  });

  it("is remembered across a reload, per side, and an older save with no answers loads with none", () => {
    saveOnboarding("room1", run([{ type: "chip", id: "tonight" }], atFreeB()), "b");
    expect(loadOnboarding("room1", "b").free.chips).toEqual(["tonight"]);
    expect(loadOnboarding("room1", "a")).toEqual(initialOnboarding());
    const older = { step: "share", name: "Jordan", friendsOn: true, tiers: { michelle: "close", priya: "close" }, source: "sync" };
    sessionStorage.setItem("muse-friends:onboarding:room2", JSON.stringify(older));
    expect(loadOnboarding("room2")).toMatchObject({ step: "share", free: { chips: [], text: "", feels: "" } });
  });
});
