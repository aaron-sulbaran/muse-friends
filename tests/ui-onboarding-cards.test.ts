import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FriendsOptInCard } from "@/components/FriendsOptInCard";
import { OptOutCard, TurnOnFriendsPill } from "@/components/OptOutCard";
import { copy } from "@/lib/ui/copy";
import { initialOnboarding } from "@/lib/ui/onboarding";

const noop = () => undefined;
/** Escapes the way React does, so a string with an apostrophe can be found in markup. */
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

describe("the Friends card", () => {
  const html = renderToStaticMarkup(createElement(FriendsOptInCard, { state: initialOnboarding(), dispatch: noop }));

  it("asks for a first name, explains Friends in a line and three points, and says it can change", () => {
    for (const line of [copy.onboarding.nameTitle, copy.onboarding.friendsLine, ...copy.onboarding.friendsPoints, copy.onboarding.changeAnytime]) {
      expect(html).toContain(escaped(line));
    }
    expect(html).toContain(`placeholder="${copy.onboarding.namePlaceholder}"`);
    expect(html).toMatch(/autocomplete="given-name"/i);
  });

  it("keeps the name field at 16px so iOS does not zoom, in the group fill with a 14px radius", () => {
    expect(html).toMatch(/<input[^>]*class="[^"]*rounded-\[14px\][^"]*bg-group[^"]*text-\[16px\]/);
  });

  it("offers Not now and Turn on Friends at the same size, with no guilt copy", () => {
    const pills = [...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*>([^<]*)<\/button>/g)].map(([, classes, label]) => ({ classes, label }));
    expect(pills.map((pill) => pill.label)).toEqual([copy.onboarding.notNow, copy.onboarding.turnOn]);
    const size = (classes: string) => classes.split(" ").filter((name) => /^(px|py|text-\[|font-|rounded-full)/.test(name)).sort();
    expect(size(pills[0].classes)).toEqual(size(pills[1].classes));
    expect(html).toContain("grid-cols-2");
  });

  it("has no emoji", () => {
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("the opt-out card", () => {
  const html = renderToStaticMarkup(createElement(OptOutCard));

  it("says what stops, what continues and what never happens, then offers Got it", () => {
    for (const line of [copy.onboarding.optOutTitle, copy.onboarding.optOutOff, copy.onboarding.optOutNothingShared, copy.onboarding.gotIt, copy.onboarding.turnOnAnytime]) {
      expect(html).toContain(escaped(line));
    }
  });

  it("does not push back toward Friends inside the card", () => {
    expect(html).not.toContain(escaped(copy.onboarding.turnOn));
  });

  it("has one way back in, as its own pill", () => {
    expect(renderToStaticMarkup(createElement(TurnOnFriendsPill, { onTurnOn: noop }))).toContain(copy.onboarding.turnOn);
  });
});
