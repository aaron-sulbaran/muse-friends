import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvatarSheet } from "@/components/AvatarSheet";
import { FriendDiscWithMuse } from "@/components/FriendDiscWithMuse";
import { ShareSheet } from "@/components/ShareSheet";
import { categoriesForTier } from "@/lib/agent/controls";
import { SEEDED_FRIENDS } from "@/lib/seed/friends";
import { SWITCH_ROWS } from "@/lib/ui/categories";
import type { ShareTier, SharingSettings } from "@/lib/ui/types";

const noop = () => undefined;
const [michelle, priya] = SEEDED_FRIENDS;
const sharingFor = (tier: ShareTier): SharingSettings => ({ tier, categories: categoriesForTier(tier) });
const sheet = (tier: ShareTier) => renderToStaticMarkup(createElement(ShareSheet, { friend: michelle, tier, sharing: sharingFor(tier), onChange: noop, onBack: noop, onDone: noop }));
const escaped = (line: string) => line.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

/** Each switch in the markup, by order, with whether it is on and whether it is locked. */
function switches(html: string) {
  return [...html.matchAll(/<input[^>]*role="switch"[^>]*>/g)].map(([tag]) => ({ on: /\schecked=""/.test(tag), locked: /\sdisabled=""/.test(tag) }));
}

describe("the share sheet", () => {
  const html = sheet("close");

  it("asks what the friend's Muse can see, and says where the switches came from", () => {
    expect(html).toContain(escaped("What can Michelle's Muse see?"));
    expect(html).toContain(escaped("Set from Michelle's group, Close friend. Change any of them. Off means Muse leaves it out and says so in Activity."));
  });

  it("lists the four switches with the spec's labels and lines, in order", () => {
    const labels = ["Restaurants and food", "Cities and where I am", "Events", "Interests"];
    const lines = ["Places you saved, and what you like to eat", "Your city or neighborhood, never an exact spot", "Shows and plans you saved", "What you like, in a few words"];
    expect(SWITCH_ROWS.map((row) => row.label)).toEqual(labels);
    let at = 0;
    for (const text of [...labels, ...lines].map(escaped)) expect(html).toContain(text);
    for (const label of labels) {
      const found = html.indexOf(escaped(label));
      expect(found).toBeGreaterThan(at);
      at = found;
    }
  });

  it("has exactly four switches, so free times can never be switched off here", () => {
    expect(switches(html)).toHaveLength(4);
    expect(html).not.toMatch(/Free times<\/span>/);
  });

  it("states the two fixed lines under the switches", () => {
    expect(html).toContain("Free times are always included: open windows only, never what is in them.");
    expect(html).toContain("Calendar event names are never shared.");
  });

  it("fills all four switches for a close friend, and restaurants and food only for a friend", () => {
    expect(switches(sheet("close")).map((item) => item.on)).toEqual([true, true, true, true]);
    expect(switches(sheet("friend")).map((item) => item.on)).toEqual([true, false, false, false]);
    expect(sheet("friend")).toContain("Set from Michelle&#x27;s group, Friend.");
  });

  it("follows a switch the judge changed, whichever sheet changed it", () => {
    const changed = renderToStaticMarkup(
      createElement(ShareSheet, { friend: michelle, tier: "friend", sharing: { tier: "friend", categories: { ...categoriesForTier("friend"), events: true } }, onChange: noop, onBack: noop, onDone: noop }),
    );
    expect(switches(changed).map((item) => item.on)).toEqual([true, false, true, false]);
  });

  it("ends with Back and Done at the same size", () => {
    const pills = [...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*>([^<]*)<\/button>/g)].map(([, classes, label]) => ({ classes, label }));
    expect(pills.map((pill) => pill.label)).toEqual(["Back", "Done"]);
    const size = (classes: string) => classes.split(" ").filter((name) => /^(px|py|text-\[|font-|rounded-full)/.test(name)).sort();
    expect(size(pills[0].classes)).toEqual(size(pills[1].classes));
  });

  it("has no em dashes and no emoji", () => {
    expect(html).not.toMatch(/—|–/);
    expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("the friend's disc with their Muse behind it", () => {
  it("draws Mochi's peek behind Michelle's disc at 55 by 48, its left edge 8px inside the disc's right edge", () => {
    const html = renderToStaticMarkup(createElement(FriendDiscWithMuse, { initial: "M", museModel: "mochi" }));
    expect(html).toContain("/avatars/mochi-peek-wave.webp");
    expect(html).toMatch(/left:36px/);
    expect(html).toMatch(/width:55px/);
    expect(html).toMatch(/height:48px/);
    // The peek comes first in the markup, so the disc, with its ring, is on top.
    expect(html.indexOf("mochi-peek-wave")).toBeLessThan(html.indexOf(">M<"));
    expect(html).toContain("ring-[3px]");
  });

  it("shows the disc alone for a friend whose Muse has no model", () => {
    const html = renderToStaticMarkup(createElement(FriendDiscWithMuse, { initial: priya.initial, museModel: priya.museModel }));
    expect(html).not.toContain("peek");
    expect(html).not.toContain("<img");
    expect(html).toContain(">P<");
  });

  it("scales the peek with the disc", () => {
    const html = renderToStaticMarkup(createElement(FriendDiscWithMuse, { initial: "M", museModel: "mochi", size: 88 }));
    expect(html).toMatch(/left:72px/);
    expect(html).toMatch(/width:110px/);
  });
});

describe("the avatar sheet says the same things as the share sheet", () => {
  const html = renderToStaticMarkup(createElement(AvatarSheet, { museName: "Mochi", friendMuseName: "Sprout", sharing: sharingFor("close"), onChanged: noop, onClose: noop }));

  it("uses the relabeled rows, and drops the old names", () => {
    for (const row of SWITCH_ROWS) {
      expect(html).toContain(escaped(row.label));
      expect(html).toContain(escaped(row.line));
    }
    expect(html).not.toContain("Food and places");
    expect(html).not.toContain(">Location<");
  });

  it("keeps Free times on and locked, with the spec's wording", () => {
    const all = switches(html);
    expect(all).toHaveLength(5);
    expect(all.at(-1)).toEqual({ on: true, locked: true });
    expect(html).toContain("Always included: open windows only, never what is in them");
  });
});
