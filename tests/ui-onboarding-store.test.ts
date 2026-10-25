import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialOnboarding } from "@/lib/ui/onboarding";
import { dispatchOnboarding, readOnboarding, resetOnboardingStore, serverOnboarding, subscribeOnboarding } from "@/lib/ui/onboarding-store";

function stubSessionStorage() {
  const items = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  });
  return items;
}

beforeEach(() => {
  resetOnboardingStore();
  stubSessionStorage();
});
afterEach(() => vi.unstubAllGlobals());

describe("the onboarding store", () => {
  it("starts every room at the first step, and the server always shows it", () => {
    expect(readOnboarding("r1")).toEqual(initialOnboarding());
    expect(serverOnboarding).toEqual(initialOnboarding());
    expect(readOnboarding("r1")).toBe(readOnboarding("r1"));
  });

  it("advances a room, keeps rooms apart, and tells subscribers once per change", () => {
    const heard = vi.fn();
    const stop = subscribeOnboarding(heard);
    dispatchOnboarding("r1", { type: "friendsOn" });
    expect(readOnboarding("r1")).toMatchObject({ step: "who", friendsOn: true });
    expect(readOnboarding("r2").step).toBe("name");
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    dispatchOnboarding("r1", { type: "pick" });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("does not notify for an action that changes nothing", () => {
    const heard = vi.fn();
    subscribeOnboarding(heard);
    dispatchOnboarding("r1", { type: "sync" });
    dispatchOnboarding("r1", { type: "continue" });
    expect(heard).not.toHaveBeenCalled();
    expect(readOnboarding("r1").step).toBe("name");
  });

  it("resumes the same step and name after a reload, and a new room starts over", () => {
    dispatchOnboarding("r1", { type: "name", name: " Jordan " });
    dispatchOnboarding("r1", { type: "friendsOn" });
    dispatchOnboarding("r1", { type: "sync" });
    resetOnboardingStore();
    expect(readOnboarding("r1")).toMatchObject({ step: "who", name: "Jordan", source: "sync" });
    expect(readOnboarding("r2").step).toBe("name");
  });

  it("still advances when storage is blocked, it just does not survive a reload", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    dispatchOnboarding("r1", { type: "friendsOn" });
    expect(readOnboarding("r1").step).toBe("who");
    resetOnboardingStore();
    expect(readOnboarding("r1").step).toBe("name");
  });
});

describe("the two sides of one room", () => {
  it("keep their own step, so two tabs on a room never share an answer", () => {
    dispatchOnboarding("r9", { type: "name", name: "Sam" }, "b");
    dispatchOnboarding("r9", { type: "free" }, "b");
    expect(readOnboarding("r9", "b")).toMatchObject({ step: "free", name: "Sam" });
    expect(readOnboarding("r9", "a")).toEqual(initialOnboarding());
    resetOnboardingStore();
    expect(readOnboarding("r9", "b")).toMatchObject({ step: "free", name: "Sam" });
  });
});
