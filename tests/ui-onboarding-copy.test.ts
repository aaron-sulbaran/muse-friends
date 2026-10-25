import { describe, expect, it } from "vitest";
import { onboardingCopy } from "@/lib/ui/copy";

/** Every string in the onboarding copy, with the functions called on a friend's name. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return strings((value as (friend: string) => unknown)("Michelle"));
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

describe("the onboarding copy is the spec's, word for word", () => {
  const text = onboardingCopy;

  it("greets and asks for a name", () => {
    expect(text.greeting).toBe("Hi, I'm Sprout, your Muse.");
    expect(text.nameTitle).toBe("What should friends call you?");
    expect(text.namePlaceholder).toBe("First name");
  });

  it("explains Friends in a line and three points, then offers two equal choices", () => {
    expect(text.friendsLine).toBe("Friends lets your Muse and a friend's Muse find a time together.");
    expect(text.friendsPoints).toEqual(["Only people you pick are included.", "You choose what it can mention.", "It never guesses closeness from how often you text."]);
    expect(text.notNow).toBe("Not now");
    expect(text.turnOn).toBe("Turn on Friends");
    expect(text.changeAnytime).toBe("Change this anytime in Sharing.");
  });

  it("says what an opt-out means: what stops, what continues, what never happens", () => {
    expect(text.optOutTitle).toBe("Here is what we consider when you opt out");
    expect(text.optOutOff).toBe(
      "Friends is off. Your Muse will not talk to friends' Muses, and theirs will not talk to yours. It still helps with what you tell it directly.",
    );
    expect(text.optOutNothingShared).toBe(
      "If a friend tells their own Muse about plans with you, that stays in their Muse. We do not guess who is close to you, and nothing about you is shared.",
    );
    expect(text.gotIt).toBe("Got it");
    expect(text.turnOnAnytime).toBe("Turn it on anytime in Sharing.");
    expect(text.needsFriends("Michelle")).toBe("Want to plan this with Michelle? That needs Friends.");
  });

  it("has no em dashes, no emoji and no guilt words anywhere", () => {
    for (const line of strings(text)) {
      expect(line).not.toMatch(/—|–/);
      expect(line).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(line.toLowerCase()).not.toMatch(/miss out|are you sure|too bad|sad/);
    }
  });
});
