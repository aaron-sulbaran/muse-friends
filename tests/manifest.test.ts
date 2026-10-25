import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { metadata } from "@/app/layout";
import manifest from "@/app/manifest";

const publicFile = (src: string) => path.join(process.cwd(), "public", src);

// A PNG stores its width and height as two 32-bit numbers right after the 8-byte signature and the
// chunk header, at bytes 16 to 23.
function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("web app manifest", () => {
  const result = manifest();

  it("names the app and opens it standalone at the stage", () => {
    expect(result).toMatchObject({
      name: "Muse Friends",
      short_name: "Muse Friends",
      start_url: "/",
      display: "standalone",
    });
  });

  it("uses the phone screen color for the window and the splash", () => {
    expect(result.background_color).toBe("#fafafa");
    expect(result.theme_color).toBe("#fafafa");
  });

  it("lists a 192 and a 512 pixel PNG icon that exist at exactly those sizes", () => {
    const icons = result.icons ?? [];
    expect(icons.map((icon) => icon.sizes).sort()).toEqual(["192x192", "512x512"]);
    for (const icon of icons) {
      expect(icon.type).toBe("image/png");
      expect(existsSync(publicFile(icon.src))).toBe(true);
      const [width, height] = (icon.sizes ?? "").split("x").map(Number);
      expect(pngSize(publicFile(icon.src))).toEqual({ width, height });
    }
  });

  it("has no service worker and no push behind it", () => {
    expect(existsSync(publicFile("sw.js"))).toBe(false);
    expect(existsSync(publicFile("service-worker.js"))).toBe(false);
  });
});

describe("apple web app metadata", () => {
  it("lets iOS open the Home Screen icon as an app titled Muse Friends", () => {
    expect(metadata.appleWebApp).toEqual({ capable: true, title: "Muse Friends", statusBarStyle: "default" });
  });
});
