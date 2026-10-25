import { describe, expect, it } from "vitest";
import { friendsIndicator, needsMichelleOnLoad, onboardingBypassed, pickerMode, roomFriendTier, ROOM_FRIEND, shareFriend, startRequest, startsRunAtDone } from "@/lib/ui/onboarding-flow";
import { initialOnboarding, reduceOnboarding, type OnboardingAction } from "@/lib/ui/onboarding";

const after = (...actions: OnboardingAction[]) => actions.reduce(reduceOnboarding, initialOnboarding());

describe("which sheet is open", () => {
  it("shows no sheet on the first card, the choice after Turn on Friends, then the list the judge picked", () => {
    expect(pickerMode(initialOnboarding())).toBeNull();
    expect(pickerMode(after({ type: "friendsOn" }))).toBe("choose");
    expect(pickerMode(after({ type: "friendsOn" }, { type: "sync" }))).toBe("synced");
    expect(pickerMode(after({ type: "friendsOn" }, { type: "pick" }))).toBe("pick");
  });

  it("shows the share sheet for the room's friend after Continue, and nothing once it is done or opted out", () => {
    const share = after({ type: "friendsOn" }, { type: "sync" }, { type: "continue" });
    expect(shareFriend(share)?.name).toBe("Michelle");
    expect(pickerMode(share)).toBeNull();
    expect(shareFriend(reduceOnboarding(share, { type: "done" }))).toBeNull();
    expect(shareFriend(after({ type: "notNow" }))).toBeNull();
  });

  it("goes back from the share sheet to the list the judge was on", () => {
    const back = after({ type: "friendsOn" }, { type: "pick" }, { type: "tier", friendId: "michelle", tier: "close" }, { type: "continue" }, { type: "back" });
    expect(pickerMode(back)).toBe("pick");
    expect(roomFriendTier(back)).toBe("close");
  });
});

describe("what Done starts", () => {
  it("starts the arrival and the run only when Friends is on and the room's friend is above Off", () => {
    expect(startsRunAtDone(after({ type: "friendsOn" }, { type: "sync" }, { type: "continue" }))).toBe(true);
    expect(startsRunAtDone(after({ type: "friendsOn" }, { type: "pick" }, { type: "tier", friendId: "michelle", tier: "friend" }, { type: "continue" }))).toBe(true);
  });

  it("starts nothing for the opt-out, or with the friend left at Off", () => {
    expect(startsRunAtDone(initialOnboarding())).toBe(false);
    expect(startsRunAtDone(after({ type: "notNow" }))).toBe(false);
    expect(startsRunAtDone(after({ type: "friendsOn" }, { type: "pick" }, { type: "tier", friendId: "priya", tier: "close" }))).toBe(false);
  });
});

describe("what Continue writes", () => {
  it("is the room's friend, Michelle, with her Muse", () => {
    expect(ROOM_FRIEND).toMatchObject({ id: "michelle", museModel: "mochi" });
  });

  it("writes the tier the judge gave her and starts the plan", () => {
    expect(startRequest(after({ type: "friendsOn" }, { type: "sync" }))).toEqual({ tier: "close" });
    expect(startRequest(after({ type: "friendsOn" }, { type: "pick" }, { type: "tier", friendId: "michelle", tier: "friend" }))).toEqual({ tier: "friend" });
  });

  it("starts nothing while she is at Off, however the others are set", () => {
    expect(startRequest(initialOnboarding())).toBeNull();
    expect(startRequest(after({ type: "friendsOn" }, { type: "pick" }, { type: "tier", friendId: "priya", tier: "close" }))).toBeNull();
    expect(startRequest(after({ type: "notNow" }))).toBeNull();
  });
});

describe("the Friends is on indicator", () => {
  it("shows once Friends is on and never after an opt-out", () => {
    expect(friendsIndicator(after({ type: "friendsOn" }))).toBe("Friends is on");
    expect(friendsIndicator(after({ type: "friendsOn" }, { type: "sync" }, { type: "continue" }, { type: "done" }))).toBe("Friends is on");
    expect(friendsIndicator(initialOnboarding())).toBeNull();
    expect(friendsIndicator(after({ type: "notNow" }))).toBeNull();
    expect(friendsIndicator(after({ type: "friendsOn" }, { type: "pick" }, { type: "continue" }))).toBeNull();
  });
});

describe("skipping onboarding", () => {
  it("is for the presenter's stage and tests, by ?onboarding=off, and nothing else", () => {
    expect(onboardingBypassed("?onboarding=off")).toBe(true);
    expect(onboardingBypassed("?room=abc&onboarding=off")).toBe(true);
    expect(onboardingBypassed("?onboarding=on")).toBe(false);
    expect(onboardingBypassed("")).toBe(false);
  });
});

describe("a fresh phone room", () => {
  it("turns Michelle on when there is no plan and no simulated friend, so the judge lands on the reel", () => {
    expect(needsMichelleOnLoad({ plan: null, simulatedFriend: false })).toBe(true);
    expect(needsMichelleOnLoad({ plan: null, simulatedFriend: true })).toBe(false);
  });

  it("leaves a run that is already going alone", () => {
    const plan = { id: "p" } as never;
    expect(needsMichelleOnLoad({ plan, simulatedFriend: false })).toBe(false);
  });
});
