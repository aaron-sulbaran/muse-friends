import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("the README's logo", () => {
  const readme = readFileSync("README.md", "utf8");
  const source = /<img src="([^"]+)"/.exec(readme)?.[1] ?? "";

  it("is the current lockup, a file that exists, and not the retired wordmark", () => {
    expect(source).toBe("public/brand/muse-friends-lockup.png");
    expect(existsSync(source)).toBe(true);
    expect(readme).not.toContain("muse-friends-wordmark.svg");
    expect(existsSync("public/wordmark/muse-friends-wordmark.svg")).toBe(false);
  });

  it("is a PNG of the lockup at a size a README can show, with alt text that says what it is", () => {
    const png = readFileSync(source);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1160, 380]);
    expect(png.length).toBeLessThan(150_000);
    expect(readme).toContain('alt="Muse Friends, a proposal for Muse"');
  });

  it("nothing else in the app or the docs still points at the retired file", () => {
    for (const file of ["components/AvatarSheet.tsx", "components/HowPage.tsx", "components/TopBar.tsx", "app/layout.tsx"]) {
      expect(readFileSync(file, "utf8"), file).not.toContain("muse-friends-wordmark");
    }
  });
});
