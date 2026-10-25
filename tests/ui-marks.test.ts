import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CHECK_BLUE, CheckMark } from "@/components/CheckMark";
import { GoalsTab } from "@/components/GoalsTab";
import { InstagramGlyph } from "@/components/marks/InstagramGlyph";
import { WhatsAppGlyph } from "@/components/marks/WhatsAppGlyph";
import { ReelCard } from "@/components/ReelCard";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { viewForRole } from "@/lib/ui/chat";
import { copy } from "@/lib/ui/copy";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import type { PlanState } from "@/lib/ui/types";

const at = (state: PlanState) => toUiSnapshot(snapshotAtPlanState(state), { mode: "live" });

describe("Muse's blue check mark", () => {
  it("is one inline SVG in one blue, sized by the caller", () => {
    const small = renderToStaticMarkup(createElement(CheckMark));
    const big = renderToStaticMarkup(createElement(CheckMark, { className: "size-5" }));
    for (const html of [small, big]) {
      expect(html).toContain('data-mark="check"');
      expect(html).toContain(`stroke="${CHECK_BLUE}"`);
      expect(html).toContain('aria-hidden="true"');
      // A ring and a heavier tick on a 24 grid, as in Muse's own mark; never a filled disc.
      expect(html).toContain('r="9.75"');
      expect(html).toContain('stroke-width="2.1"');
      expect(html).toContain('stroke-width="2.6"');
      expect(html).toContain('fill="none"');
    }
    expect(small).toContain("size-4");
    expect(big).toContain("size-5");
    expect(CHECK_BLUE).toBe("#0058DC");
  });

  it("is the only check on the site: no component draws a lucide Check, and no copy string types a tick", () => {
    for (const file of readdirSync("components").filter((name) => name.endsWith(".tsx"))) {
      const source = readFileSync(`components/${file}`, "utf8");
      const lucide = source.match(/import \{([^}]*)\} from "lucide-react"/g)?.join(" ") ?? "";
      expect(lucide, file).not.toMatch(/\bCheck\b/);
      expect(lucide, file).not.toMatch(/\bCheckCircle2?\b/);
    }
    const strings = Object.values(copy).flatMap((value) => {
      if (typeof value !== "function") return [String(value)];
      try {
        return [String((value as (...args: string[]) => string)("A", "B", "C"))];
      } catch {
        return []; // a formatter that wants a real date, not a name
      }
    });
    expect(strings.length).toBeGreaterThan(100);
    for (const value of strings) expect(value).not.toMatch(/[\u2713\u2714]/);
  });

  it("goes in front of the words You said yes and Done. It's in Goals, drawn by the chat rather than typed", () => {
    expect(copy.youSaidYes).toBe("You said yes");
    expect(copy.closingLine).toBe("Done. It's in Goals.");
    const items = viewForRole(at("confirmed"), "a").items.filter((item) => item.kind === "collapsed");
    expect(items.some((item) => item.text === copy.youSaidYes && item.check === true)).toBe(true);
    const done = viewForRole(at("followed_up"), "a").items.filter((item) => item.kind === "collapsed" && item.id === "closing");
    for (const item of done) expect(item.kind === "collapsed" && item.check).toBe(true);
  });
});

describe("the Goals checks", () => {
  const goals = (state: PlanState) => {
    const snapshot = at(state);
    return renderToStaticMarkup(createElement(GoalsTab, { plan: snapshot.plan, context: { friend: "Michelle", simulatedFriend: false } as never, onOpen: () => {} }));
  };

  it("draw the blue check for a done goal, in place of the green badge", () => {
    const html = goals("followed_up");
    expect(html).toContain('data-mark="check"');
    expect(html).not.toContain("bg-tracking text-surface");
    expect(html).not.toContain("lucide-check");
  });
});

describe("the Instagram link", () => {
  it("carries the Instagram glyph, not the external link arrow", () => {
    const html = renderToStaticMarkup(createElement(ReelCard, { poster: "the.foodie.patootie", caption: "x", place: "Shawarma Point", align: "left", permalink: "https://www.instagram.com/reel/Abc123/" }));
    expect(html).toContain("View on Instagram");
    expect(html).toContain('data-glyph="instagram"');
    expect(html).not.toContain("lucide-external-link");
  });

  it("is not drawn for the seeded reel, which has no Instagram address", () => {
    const html = renderToStaticMarkup(createElement(ReelCard, { poster: "eastside.eats.atx", caption: "x", place: "Shawarma Point", align: "left" }));
    expect(html).not.toContain("View on Instagram");
  });
});

describe("the Meta app glyphs", () => {
  it("are one currentColor path each on a 24 grid, so they take the color of the link or button they sit in", () => {
    for (const [html, name] of [[renderToStaticMarkup(createElement(InstagramGlyph)), "instagram"], [renderToStaticMarkup(createElement(WhatsAppGlyph)), "whatsapp"]] as const) {
      expect(html).toContain(`data-glyph="${name}"`);
      expect(html).toContain('viewBox="0 0 24 24"');
      expect(html).toContain('fill="currentColor"');
      expect(html).toContain('aria-hidden="true"');
      expect(html.match(/<path /g)).toHaveLength(1);
    }
  });

  it("are 14 pixels beside the reel link's text and 18 pixels in the WhatsApp pill", () => {
    expect(renderToStaticMarkup(createElement(InstagramGlyph))).toContain("size-3.5");
    expect(renderToStaticMarkup(createElement(WhatsAppGlyph))).toContain("size-[18px]");
  });
});
