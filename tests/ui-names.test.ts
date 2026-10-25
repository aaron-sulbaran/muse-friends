import { describe, expect, it } from "vitest";
import { OTHER_SIGNALS, SHAWARMA_REEL } from "@/lib/seed/past-signals";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { viewForRole } from "@/lib/ui/chat";
import { copy } from "@/lib/ui/copy";
import { namesFor } from "@/lib/ui/format";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import { capital, isUnnamed, unnamedFriend } from "@/lib/ui/tokens";
import type { PlanState, UiSnapshot } from "@/lib/ui/types";

const MUSE_NAMES = ["Sprout", "Mochi", "Michelle's Muse"];
const at = (state: PlanState, over: Partial<UiSnapshot> = {}): UiSnapshot => ({ ...toUiSnapshot(snapshotAtPlanState(state), { mode: "live" }), simulatedFriend: false, ...over });
const bubbles = (snapshot: UiSnapshot, role: "a" | "b") =>
  viewForRole(snapshot, role).items.flatMap((item) => (item.kind === "bubble" ? [item.text] : []));

describe("who the other person is called", () => {
  it("is your friend when nobody has said, on either side, and never a Muse's name", () => {
    const names = namesFor(at("scheduled"));
    expect(names.human).toEqual({ aaron: unnamedFriend, lisa: unnamedFriend });
    expect(names.muse).toEqual({ aaron: "Sprout", lisa: "Mochi" });
    for (const human of Object.values(names.human)) expect(MUSE_NAMES).not.toContain(human);
  });

  it("is Michelle on the simulated friend's side, and still your friend on the judge's", () => {
    const names = namesFor(at("scheduled", { simulatedFriend: true }));
    expect(names.human).toEqual({ aaron: unnamedFriend, lisa: "Michelle" });
    expect(names.muse.lisa).toBe("Michelle's Muse");
  });

  it("passes a real name through unchanged, from onboarding or a second phone", () => {
    const names = namesFor(at("scheduled", { humans: { aaron: "Jordan", lisa: "Riley" } }));
    expect(names.human).toEqual({ aaron: "Jordan", lisa: "Riley" });
    expect(namesFor(at("scheduled", { simulatedFriend: true, humans: { aaron: "Jordan" } })).human).toEqual({ aaron: "Jordan", lisa: "Michelle" });
  });

  it("treats a blank name as no name", () => {
    expect(namesFor(at("scheduled", { humans: { aaron: "   " } })).human.aaron).toBe(unnamedFriend);
    expect(isUnnamed(unnamedFriend)).toBe(true);
    expect(isUnnamed("Jordan")).toBe(false);
    expect(capital("your friend")).toBe("Your friend");
  });
});

describe("Michelle's phone, while the judge is unnamed", () => {
  const confirmed = at("confirmed", { simulatedFriend: true });
  const texts = bubbles(confirmed, "b");
  const view = viewForRole(confirmed, "b");

  it("says the reel was sent without naming a Muse as a person", () => {
    expect(texts).toContain("You sent this a week ago. I'm checking if you two can make it happen.");
  });

  it("says you both want to try the place", () => {
    expect(texts.some((text) => /^You both want to try .+, and you're both free .+\.$/.test(text))).toBe(true);
  });

  it("says your friend is sending the WhatsApp message", () => {
    expect(texts).toContain("Your friend is sending you a message on WhatsApp.");
  });

  it("never calls a Muse a person in any line", () => {
    const sentences = [...texts, view.friendHumanName, copy.cardTitle(view.museName, view.friendHumanName)];
    for (const text of sentences) {
      expect(text).not.toMatch(/\bSprout (sent|is sending|said|wants)\b/);
      expect(text).not.toMatch(/with Sprout\b/);
      expect(text).not.toMatch(/\bSprout's (in|reel)\b/);
    }
    expect(view.friendHumanName).toBe(unnamedFriend);
  });
});

describe("when the judge has a name, it flows through on Michelle's phone", () => {
  const named = at("confirmed", { simulatedFriend: true, humans: { aaron: "Jordan" } });
  const texts = bubbles(named, "b");

  it("uses the person's name, never their Muse's, in every sentence", () => {
    expect(texts).toContain("You sent Jordan this a week ago. I'm checking if you two can make it happen.");
    expect(texts.some((text) => /^You and Jordan both want to try .+, and you're both free .+\.$/.test(text))).toBe(true);
    expect(texts).toContain("Jordan is sending you a message on WhatsApp.");
    expect(viewForRole(named, "b").friendHumanName).toBe("Jordan");
  });
});

describe("the judge's phone with Michelle as the friend is unchanged", () => {
  const texts = bubbles(at("confirmed", { simulatedFriend: true }), "a");

  it("keeps Michelle in every line", () => {
    expect(texts).toContain("Michelle sent you this a week ago. Want me to see if you two can make it happen?");
    expect(texts.some((text) => /^You and Michelle both want to try .+, and you're both free .+\.$/.test(text))).toBe(true);
    expect(texts).toContain("Michelle's in. Here's a message you can send Michelle.");
  });
});

describe("sentences that start with the other person's name", () => {
  it("start with a capital when it is your friend", () => {
    expect(copy.friendPassed(unnamedFriend)).toBe("Your friend said not now.");
    expect(copy.draftIntroA(unnamedFriend)).toBe("Your friend's in. Here's a message you can send your friend.");
    expect(copy.dropped(unnamedFriend)).toBe("Your friend's Muse couldn't find a time that works this week. I'll keep an eye out.");
    expect(copy.paymentReceived("$15", unnamedFriend)).toBe("Your friend sent you $15");
    expect(copy.paymentKept(unnamedFriend)).toBe("Your friend has it");
    expect(copy.proposalBubble(unnamedFriend, "Shawarma Point", "Tuesday 6 to 8")).toBe("You both want to try Shawarma Point, and you're both free Tuesday 6 to 8.");
    expect(copy.proposalBubble("Jordan", "Shawarma Point", "Tuesday 6 to 8")).toBe("You and Jordan both want to try Shawarma Point, and you're both free Tuesday 6 to 8.");
  });

  it("read the same as before for a named person", () => {
    expect(copy.friendPassed("Michelle")).toBe("Michelle said not now.");
    expect(copy.draftIntroB("Michelle")).toBe("Michelle is sending you a message on WhatsApp.");
    expect(copy.paymentReceived("$15", "Michelle")).toBe("Michelle sent you $15");
  });
});

describe("the past shares", () => {
  it("say so plainly with no name, and keep the name when there is one", () => {
    expect(SHAWARMA_REEL.nextIdeaMine(unnamedFriend)).toBe("You sent this a week ago. I'm checking if you two can make it happen.");
    expect(SHAWARMA_REEL.nextIdea(unnamedFriend)).toBe("Your friend sent you this a week ago. Want me to see if you two can make it happen?");
    expect(SHAWARMA_REEL.nextIdeaMine("Jordan")).toBe("You sent Jordan this a week ago. I'm checking if you two can make it happen.");
    expect(SHAWARMA_REEL.nextIdea("Michelle")).toBe("Michelle sent you this a week ago. Want me to see if you two can make it happen?");
    expect(SHAWARMA_REEL.sentLine(unnamedFriend)).toMatch(/^Your friend sent you a reel\./);
  });

  it("never open a sentence in lower case, for any other share either", () => {
    for (const signal of OTHER_SIGNALS) {
      for (const text of [signal.sentLine(unnamedFriend), signal.nextIdea(unnamedFriend), signal.nextIdeaMine(unnamedFriend), signal.sentLineMine(unnamedFriend)]) {
        expect(text.charAt(0)).toBe(text.charAt(0).toUpperCase());
        expect(text).not.toContain("  ");
      }
    }
  });
});
