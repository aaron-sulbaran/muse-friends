import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReelCard } from "@/components/ReelCard";

const PICTURE = "https://scontent.cdninstagram.com/v/t51/profile.jpg";
const base = { poster: "the.foodie.patootie", caption: "the garlic sauce", place: "Shawarma Point", align: "left" as const, label: "Lisa's own reel, live from Instagram" };
const render = (extra: object = {}) => renderToStaticMarkup(createElement(ReelCard, { ...base, ...extra }));

describe("the reel poster's picture", () => {
  it("is the poster's real profile picture, round and the size of the letter circle, with their username as its alt", () => {
    const html = render({ posterImage: PICTURE });
    const image = /<img [^>]*src="https:\/\/scontent[^>]*>/.exec(html)?.[0] ?? "";
    expect(image).toContain(`src="${PICTURE}"`);
    expect(image).toContain('alt="the.foodie.patootie"');
    expect(image).toContain("size-6");
    expect(image).toContain("rounded-full");
    expect(image).toContain('referrerPolicy="no-referrer"');
    expect(html).not.toContain("from-amber-400");
  });

  it("stays the first letter in the gradient circle for the seeded reel, which has no picture", () => {
    const html = render();
    expect(html).toContain("from-amber-400");
    expect(html).toMatch(/uppercase[^>]*>t<\/span>/);
    expect(html).not.toContain('alt="the.foodie.patootie"');
  });
});
