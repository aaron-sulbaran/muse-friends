import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvatarSheet } from "@/components/AvatarSheet";
import { FriendPickerSheet } from "@/components/FriendPickerSheet";
import { SEEDED_FRIENDS } from "@/lib/seed/friends";
import { onboardingCopy } from "@/lib/ui/copy";
import { initialOnboarding, reduceOnboarding, type OnboardingAction } from "@/lib/ui/onboarding";

const noop = () => undefined;
const stateAfter = (...actions: OnboardingAction[]) => actions.reduce(reduceOnboarding, initialOnboarding());
const render = (mode: "choose" | "synced" | "pick", state = stateAfter({ type: "friendsOn" })) =>
  renderToStaticMarkup(createElement(FriendPickerSheet, { mode, state, dispatch: noop, onClose: noop }));
const escaped = (line: string) => line.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

/** Each radio group in the markup, with the value it has checked and the ones it has disabled. */
function radioGroups(html: string) {
  const groups = new Map<string, { checked: string[]; disabled: string[]; values: string[] }>();
  for (const [tag] of html.matchAll(/<input[^>]*type="radio"[^>]*>/g)) {
    const name = /name="([^"]*)"/.exec(tag)?.[1] ?? "";
    const value = /value="([^"]*)"/.exec(tag)?.[1] ?? "";
    const group = groups.get(name) ?? { checked: [], disabled: [], values: [] };
    group.values.push(value);
    if (/\schecked=""/.test(tag)) group.checked.push(value);
    if (/\sdisabled=""/.test(tag)) group.disabled.push(value);
    groups.set(name, group);
  }
  return [...groups.values()];
}

describe("the seeded friends", () => {
  it("lists Michelle first, with her fact and her Muse, then Priya with no Muse to show", () => {
    expect(SEEDED_FRIENDS[0]).toMatchObject({ id: "michelle", name: "Michelle", initial: "M", fact: "Sent you a reel today", onInstagramCloseFriends: true, museModel: "mochi" });
    expect(SEEDED_FRIENDS[1]).toMatchObject({ id: "priya", name: "Priya", fact: "On your Instagram Close Friends", museModel: null });
  });

  it("has one id per friend, and an initial that is the name's first letter", () => {
    expect(new Set(SEEDED_FRIENDS.map((friend) => friend.id)).size).toBe(SEEDED_FRIENDS.length);
    for (const friend of SEEDED_FRIENDS) expect(friend.initial).toBe(friend.name.charAt(0));
  });
});

describe("2a: sync or pick", () => {
  const html = render("choose");

  it("offers the two ways in, and says the sync is seeded", () => {
    for (const line of [text("whoTitle"), text("whoLine"), text("syncTitle"), text("syncLine"), text("pickTitle"), text("pickLine"), text("notTold"), text("notNow")]) {
      expect(html).toContain(escaped(line));
    }
    expect(html).toContain("Seeded for this demo");
  });

  it("shows no tier control yet, so nothing is chosen for anyone", () => {
    expect(radioGroups(html)).toEqual([]);
  });
});

describe("2b: the synced Close Friends list", () => {
  const html = render("synced", stateAfter({ type: "friendsOn" }, { type: "sync" }));

  it("says where the list came from, with the seeded chip", () => {
    expect(html).toContain(onboardingCopy.seededChip);
    expect(html).toContain(escaped(onboardingCopy.syncedTitle));
    expect(html).toContain(escaped(onboardingCopy.syncedLine));
  });

  it("shows every friend at Close friend, with all three tiers still choosable", () => {
    const groups = radioGroups(html);
    expect(groups).toHaveLength(SEEDED_FRIENDS.length);
    for (const group of groups) {
      expect(group.checked).toEqual(["close"]);
      expect(group.values).toEqual(["close", "friend", "off"]);
      expect(group.disabled).toEqual([]);
    }
  });

  it("tells Michelle's list fact apart from Priya's", () => {
    expect(html).toContain("On your Instagram Close Friends. Sent you a reel today.");
    expect(html).toContain("On your Instagram Close Friends.</p>");
  });

  it("ends with the not-told line and Back and Continue at the same size", () => {
    expect(html).toContain(onboardingCopy.notTold);
    const pills = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(([, label]) => label);
    expect(pills).toEqual([onboardingCopy.back, onboardingCopy.continue]);
  });
});

describe("2c: pick friends", () => {
  const html = render("pick", stateAfter({ type: "friendsOn" }, { type: "pick" }));

  it("starts every row at Off", () => {
    const groups = radioGroups(html);
    expect(groups).toHaveLength(SEEDED_FRIENDS.length);
    for (const group of groups) expect(group.checked).toEqual(["off"]);
  });

  it("lists Michelle first with the fact that orders the list, and has no seeded chip", () => {
    expect(html.indexOf("Michelle")).toBeLessThan(html.indexOf("Priya"));
    expect(html).toContain("Sent you a reel today");
    expect(html).not.toContain(onboardingCopy.seededChip);
  });

  it("ends with the footer and Not now beside Continue", () => {
    expect(html).toContain("They are not told which group they are in.");
    const pills = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(([, label]) => label);
    expect(pills).toEqual([onboardingCopy.notNow, onboardingCopy.continue]);
  });

  it("follows the state: a friend moved to Friend shows Friend", () => {
    const moved = render("pick", stateAfter({ type: "friendsOn" }, { type: "pick" }, { type: "tier", friendId: "michelle", tier: "friend" }));
    expect(radioGroups(moved).map((group) => group.checked[0])).toEqual(["friend", "off"]);
  });
});

describe("the avatar sheet keeps working on the extracted tier control", () => {
  const sharing = { tier: "close", categories: { food: true, events: true, availability: true, location: true, interests: true } } as const;
  const html = renderToStaticMarkup(createElement(AvatarSheet, { role: "b", museName: "Mochi", friendMuseName: "Sprout", sharing, onChanged: noop, onClose: noop }));

  it("shows the current tier, keeps Off out of reach, and still names who the friend is", () => {
    const [group] = radioGroups(html);
    expect(group.checked).toEqual(["close"]);
    expect(group.disabled).toEqual(["off"]);
    expect(html).toContain("Who Sprout is to Mochi");
  });
});

function text(key: "whoTitle" | "whoLine" | "syncTitle" | "syncLine" | "pickTitle" | "pickLine" | "notTold" | "notNow"): string {
  return onboardingCopy[key];
}
