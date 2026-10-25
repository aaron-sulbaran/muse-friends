import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MomentChips } from "@/components/MomentChips";
import { Subline } from "@/components/Subline";
import { TopBar } from "@/components/TopBar";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { copy } from "@/lib/ui/copy";
import { momentsOf } from "@/lib/ui/moments";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import type { PlanState } from "@/lib/ui/types";

const at = (state: PlanState) => toUiSnapshot(snapshotAtPlanState(state), { mode: "live" });
const reached = (state: PlanState) => momentsOf(at(state)).map((moment) => moment.reachedAt !== null);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

describe("the three moments", () => {
  it("are Said yes, Message sent and They went, in that order", () => {
    expect(momentsOf(null).map((moment) => moment.label)).toEqual(["Said yes", "Message sent", "They went"]);
  });

  it("light up one by one as the plan moves", () => {
    expect(momentsOf(null).map((moment) => moment.reachedAt)).toEqual([null, null, null]);
    expect(reached("awaiting_humans")).toEqual([false, false, false]);
    expect(reached("confirmed")).toEqual([true, false, false]);
    expect(reached("scheduled")).toEqual([true, true, false]);
    expect(reached("reminded")).toEqual([true, true, false]);
    expect(reached("followed_up")).toEqual([true, true, true]);
  });

  it("carry the time each one happened, from the plan's own history", () => {
    const snapshot = at("scheduled");
    const [saidYes, sent] = momentsOf(snapshot);
    expect(saidYes.reachedAt).toBe(snapshot.plan?.history.find((entry) => entry.state === "confirmed")?.at);
    expect(sent.reachedAt).toBe(snapshot.plan?.history.find((entry) => entry.state === "scheduled")?.at);
  });

  it("count a dropped plan as nothing reached", () => {
    expect(reached("dropped")).toEqual([false, false, false]);
  });

  it("say what each means, in the CDO's words", () => {
    expect(momentsOf(null).map((moment) => moment.line)).toEqual([
      "Both people tapped Set it up on the plan.",
      "The plan went out to both people's chats.",
      "Both people tapped We went after the plan. This is the number we measure: plans that happened, not messages sent.",
    ]);
  });
});

describe("the stage header", () => {
  const html = renderToStaticMarkup(createElement(TopBar, { snapshot: at("scheduled") }));

  it("is Meta's blue script Muse and Friends in sans, read aloud as Muse Friends", () => {
    const heading = /<h1 [^>]*>.*?<\/h1>/.exec(html)?.[0] ?? "";
    expect(heading).toContain('aria-label="Muse Friends"');
    for (const part of ["inline-flex", "items-baseline", "whitespace-nowrap", "text-[22px]", "font-semibold", "leading-none", "tracking-[-0.01em]"]) expect(heading).toContain(part);
    const script = /<img [^>]*muse-script-blue[^>]*>/.exec(heading)?.[0] ?? "";
    expect(script).toContain('src="/brand/muse-script-blue.svg"');
    expect(script).toContain('alt=""');
    expect(script).toContain('height="26"');
    expect(script).toContain('width="68"');
    for (const part of ["mb-[-2.6px]", "mr-[4.5px]", "h-[26px]", "w-auto"]) expect(script).toContain(part);
    // The word after the script is plain text, not the old two-color text lockup.
    expect(heading.replace(/<[^>]+>/g, "").trim()).toBe("Friends");
    expect(heading).not.toContain("text-accent-dot");
    expect(heading).not.toContain("font-bold");
  });

  it("is the subline a proposal for Muse by and the Meta lockup after it (D33), unchanged", () => {
    expect(copy.tagline).toBe("a proposal for Muse");
    expect(copy.taglineBy).toBe("a proposal for Muse by");
    expect(text(html)).toContain("a proposal for Muse by");
    expect(html).not.toContain("<svg");
  });

  it("shows the primary lockup sized by its letters to the subtitle, 4 pixels after by, with Meta as its alt text", () => {
    const image = /<img [^>]*alt="Meta"[^>]*>/.exec(html)?.[0] ?? "";
    expect(image).toContain('alt="Meta"');
    expect(image).toContain('src="/brand/meta-lockup-primary-12px@3x.png"');
    expect(image).toContain('srcSet="/brand/meta-lockup-primary-12px@2x.png 2x, /brand/meta-lockup-primary-12px@3x.png 3x"');
    // Sun 8:45am: the wordmark's capitals (about 8.5px) match the subtitle's, so 9 by 44, not Meta's 12px minimum.
    expect(image).toContain('height="9"');
    expect(image).toContain('width="44"');
    expect(image).toContain('class="mb-px"');
    expect(html).toMatch(/<span class="[^"]*\bgap-1\b[^"]*\bitems-end\b|<span class="[^"]*\bitems-end\b[^"]*\bgap-1\b/);
    expect(html).toMatch(/alt="Meta"[^>]*\/><\/span>/);
  });

  it("ships the script as the traced brand file, in its own blue gradient, never recolored", () => {
    const svg = readFileSync("public/brand/muse-script-blue.svg", "utf8");
    expect(svg).toContain('viewBox="0 0 353 134"');
    for (const stop of ["#0040DC", "#0064E0", "#0082FB"]) expect(svg).toContain(stop);
    expect(svg).toContain('fill="url(#muse-blue)"');
    // 26 pixels tall keeps the traced aspect: 353 by 134 is 68 by 26.
    expect(Math.round((353 / 134) * 26)).toBe(68);
  });

  it("keeps the files the lockup points at, rasterized at 2x and 3x of the 12 pixel original", () => {
    for (const [file, width, height] of [["@2x", 119, 24], ["@3x", 178, 36]] as const) {
      const png = readFileSync(`public/brand/meta-lockup-primary-12px${file}.png`);
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([width, height]);
    }
  });

  it("sets the subtitle at 12 over 16 with the logo, and with the plain text fallback, under a 22 pixel title", () => {
    const logo = renderToStaticMarkup(createElement(Subline));
    const plain = renderToStaticMarkup(createElement(Subline, { imageFailed: true }));
    for (const markup of [logo, plain]) {
      expect(markup).toContain("text-[12px]");
      expect(markup).toContain("leading-[16px]");
      expect(markup).not.toContain("text-[11px]");
    }
    expect(html).toContain("text-[22px]");
  });

  it("falls back to the plain text subline when the image does not load", () => {
    const failed = renderToStaticMarkup(createElement(Subline, { imageFailed: true }));
    expect(text(failed)).toBe("a proposal for Muse");
    expect(failed).not.toContain("<img");
    expect(failed).not.toMatch(/meta/i);
  });

  it("links How it works to /how, top right", () => {
    expect(html).toMatch(/<a [^>]*href="\/how"[^>]*>How it works<\/a>/);
  });

  it("shows the three chips and no Follow-through counter", () => {
    for (const label of ["Said yes", "Message sent", "They went"]) expect(text(html)).toContain(label);
    expect(text(html)).not.toContain("Follow-through");
  });

  it("marks what was reached for assistive tech, not by colour alone", () => {
    expect(html).toContain('aria-label="Said yes, reached"');
    expect(html).toContain('aria-label="Message sent, reached"');
    expect(html).toContain('aria-label="They went, not yet"');
  });
});

describe("a chip's info card", () => {
  const closed = () => renderToStaticMarkup(createElement(MomentChips, { moments: momentsOf(null) }));
  const card = (key: "said-yes" | "message-sent" | "they-went", onShow?: () => void) =>
    renderToStaticMarkup(createElement(MomentChips, { moments: momentsOf(at("followed_up")), initiallyOpen: key, onShow }));

  it("shows the name, the line and the time it happened", () => {
    const html = text(card("they-went"));
    expect(html).toContain("They went");
    expect(html).toContain("This is the number we measure: plans that happened, not messages sent.");
    expect(html).toMatch(/\d{1,2}:\d{2} (AM|PM)/);
  });

  it("says not yet for a moment that has not happened", () => {
    const html = renderToStaticMarkup(createElement(MomentChips, { moments: momentsOf(at("awaiting_humans")), initiallyOpen: "said-yes" }));
    expect(text(html)).toContain("Not yet");
  });

  it("offers Show in conversation only when something can scroll to it", () => {
    expect(text(card("said-yes"))).not.toContain("Show in conversation");
    expect(text(card("said-yes", () => {}))).toContain("Show in conversation");
    expect(closed()).not.toContain('role="dialog"');
  });
});
