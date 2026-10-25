import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AvatarSheet } from "@/components/AvatarSheet";
import { HowPage } from "@/components/HowPage";
import { TopBar } from "@/components/TopBar";
import { Wordmark, wordmarkMetrics } from "@/components/Wordmark";

const noop = () => {};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("the lockup's metrics follow the header's, scaled to the size", () => {
  it("is the header's 26 by 68 script, 2.6 up and 4.5 apart at 22 pixels", () => {
    expect(wordmarkMetrics(22)).toEqual({ height: 26, width: 68, lift: -2.6, gap: 4.5 });
  });

  it("scales every number together, so the lockup keeps its proportions in a larger or smaller place", () => {
    const cover = wordmarkMetrics(36);
    expect(cover.height).toBeCloseTo(42.545, 2);
    expect(cover.width).toBe(111);
    expect(cover.lift).toBeCloseTo(-4.255, 2);
    expect(cover.gap).toBeCloseTo(7.364, 2);
    expect(wordmarkMetrics(19).height).toBeCloseTo(22.45, 2);
  });
});

describe("the Wordmark", () => {
  const html = renderToStaticMarkup(createElement(Wordmark, { size: 36 }));

  it("is the script Muse and Friends in sans, read aloud as Muse Friends", () => {
    expect(html).toContain('aria-label="Muse Friends"');
    expect(html).toContain('role="img"');
    expect(html).toContain('src="/brand/muse-script-blue.svg"');
    expect(html).toContain('alt=""');
    expect(text(html)).toBe("Friends");
    for (const part of ["inline-flex", "items-baseline", "whitespace-nowrap", "font-semibold", "leading-none", "tracking-[-0.01em]"]) expect(html).toContain(part);
    expect(html).toContain("font-size:36px");
    expect(html).not.toContain("text-accent-dot");
  });
});

describe("the same lockup in every place the wordmark appears", () => {
  it("is on the /how cover, larger, with the old two-color text gone", () => {
    const how = renderToStaticMarkup(createElement(HowPage));
    expect(how).toContain('src="/brand/muse-script-blue.svg"');
    expect(how).toContain("font-size:36px");
    expect(how).not.toContain("muse-friends-wordmark.svg");
    expect(how).not.toMatch(/<span class="[^"]*text-\[36px\][^"]*font-bold/);
  });

  it("is in the settings sheet at about the old wordmark's height, not the old image", () => {
    const sheet = renderToStaticMarkup(createElement(AvatarSheet, { role: "b", initial: null, museName: "Mochi", friendMuseName: "Sprout", onChanged: noop, onClose: noop }));
    expect(sheet).toContain('src="/brand/muse-script-blue.svg"');
    expect(sheet).toContain("font-size:19px");
    expect(sheet).not.toContain("muse-friends-wordmark.svg");
    expect(sheet).toContain('aria-label="Muse Friends"');
  });

  it("still opens the stage header, which keeps its own exact classes", () => {
    const header = renderToStaticMarkup(createElement(TopBar, { snapshot: null }));
    expect(header).toContain('src="/brand/muse-script-blue.svg"');
    expect(header).toContain("text-[22px]");
  });
});
