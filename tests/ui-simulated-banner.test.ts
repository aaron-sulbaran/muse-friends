import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SimulatedFriendBanner } from "@/components/SimulatedFriendBanner";

const render = (model?: string) => renderToStaticMarkup(createElement(SimulatedFriendBanner, { model }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("the simulated friend's banner", () => {
  it("keeps its words, with the model named", () => {
    expect(text(render("muse-spark-1.3"))).toContain("Simulated friend, fictional, played by Muse Spark 1.3");
    expect(text(render("muse-spark-1.2"))).toContain("played by Muse Spark 1.2");
  });

  it("says a model before the snapshot names one", () => {
    expect(text(render())).toContain("Simulated friend, fictional, played by a model");
  });

  it("is one line: 12 over medium, tightened a hair, never breaking, with an ellipsis as the guard for a longer model id", () => {
    const html = render("muse-spark-1.3");
    const strip = /^<p class="([^"]*)"/.exec(html)?.[1] ?? "";
    for (const part of ["text-[12px]", "font-medium", "tracking-[-0.01em]", "px-3", "whitespace-nowrap", "overflow-hidden"]) expect(strip).toContain(part);
    expect(html).toContain("truncate");
    expect(strip).not.toContain("text-[13px]");
    expect(strip).not.toContain("font-semibold");
  });

  it("keeps the 20 pixel disc and the 8 pixel gap, so the banner stays one 36 pixel row", () => {
    const html = render("muse-spark-1.3");
    expect(html).toContain("gap-2");
    expect(html).toContain("py-2");
    expect(html).toMatch(/width:20px;height:20px/);
  });
});
