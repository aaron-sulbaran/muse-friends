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
  it("is the header's 23.4 by 65.8 ink-tight script, 3.95 down to center on the capitals and 5 apart at 22 pixels", () => {
    expect(wordmarkMetrics(22)).toEqual({ height: 23.4, width: 65.8, top: 3.95, gap: 5 });
  });

  it("centers the script's ink on the middle of the capitals beside it, at every size", () => {
    // The ink is 1.061F tall and "Friends" caps are 0.705F (SF at 600): top is half the difference, about 0.18F.
    for (const size of [19, 22, 36]) {
      const { height, top } = wordmarkMetrics(size);
      expect(top).toBeCloseTo((height - 0.705 * size) / 2, 0);
      expect(top / size).toBeCloseTo(0.18, 2);
    }
  });

  it("scales every number together, so the lockup keeps its proportions in a larger or smaller place", () => {
    const cover = wordmarkMetrics(36);
    expect(cover.height).toBeCloseTo(38.291, 2);
    expect(cover.width).toBeCloseTo(107.673, 2);
    expect(cover.top).toBeCloseTo(6.464, 2);
    expect(cover.gap).toBeCloseTo(8.182, 2);
    expect(wordmarkMetrics(19).height).toBeCloseTo(20.209, 2);
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
    // The offset is a `top` on a relatively positioned image, never a margin, which a baseline row ignores.
    const script = /<img [^>]*>/.exec(html)?.[0] ?? "";
    expect(script).toContain('class="relative"');
    expect(script).toMatch(/top:6\.46/);
    expect(script).not.toContain("margin-bottom");
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
