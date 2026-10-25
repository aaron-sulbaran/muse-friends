import { describe, expect, it } from "vitest";
import { rawShawarmaSignal, seedSnapshot } from "@/lib/seed/fixtures";
import { SHAWARMA_REEL } from "@/lib/seed/past-signals";
import { viewForRole } from "@/lib/ui/chat";
import { instagramEmbedUrl } from "@/lib/ui/reel";
import { toUiSnapshot } from "@/lib/ui/snapshot";

describe("which addresses get the View on Instagram link", () => {
  it("takes an instagram.com reel or post and gives back the canonical address", () => {
    expect(instagramEmbedUrl("https://www.instagram.com/reel/Cabcde12345/")).toBe("https://www.instagram.com/reel/Cabcde12345/");
    expect(instagramEmbedUrl("https://instagram.com/reel/Cabcde12345")).toBe("https://www.instagram.com/reel/Cabcde12345/");
    expect(instagramEmbedUrl("https://www.instagram.com/reels/Cabcde12345/")).toBe("https://www.instagram.com/reel/Cabcde12345/");
    expect(instagramEmbedUrl("https://www.instagram.com/p/Cabcde12345/")).toBe("https://www.instagram.com/p/Cabcde12345/");
  });

  it("drops tracking parameters and the account segment", () => {
    expect(instagramEmbedUrl("https://www.instagram.com/reel/Cabcde12345/?utm_source=ig_web_copy_link&igsh=abc")).toBe(
      "https://www.instagram.com/reel/Cabcde12345/",
    );
    expect(instagramEmbedUrl("https://www.instagram.com/someone.here/reel/Cabcde12345/")).toBe("https://www.instagram.com/reel/Cabcde12345/");
  });

  it("shows no link for anything else, including the seed's stand-in address", () => {
    expect(instagramEmbedUrl(undefined)).toBeNull();
    expect(instagramEmbedUrl("")).toBeNull();
    expect(instagramEmbedUrl("https://example.com/reel/seed-shawarma-001")).toBeNull();
    expect(instagramEmbedUrl("http://www.instagram.com/reel/Cabcde12345/")).toBeNull();
    expect(instagramEmbedUrl("https://www.instagram.com.evil.test/reel/Cabcde12345/")).toBeNull();
    expect(instagramEmbedUrl("https://evil.test/https://www.instagram.com/reel/Cabcde12345/")).toBeNull();
    expect(instagramEmbedUrl("https://www.instagram.com/explore/")).toBeNull();
    expect(instagramEmbedUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("the reel on screen is the reel the agents read", () => {
  it("shares the seeded signal's address, so changing one without the other fails here", () => {
    expect(SHAWARMA_REEL.permalink, "set lib/seed/past-signals.ts SHAWARMA_REEL.permalink to the signal's permalink in lib/seed/fixtures.ts").toBe(
      rawShawarmaSignal().media?.permalink,
    );
  });

  it("reaches the chat's reel card, and only the reel that has one", () => {
    const snapshot = toUiSnapshot(seedSnapshot(), { mode: "live" });
    const cards = viewForRole(snapshot, "a").items.filter((item) => item.kind === "reel-card");
    expect(cards.length).toBeGreaterThan(1);
    const shawarma = cards.find((item) => item.id === `${SHAWARMA_REEL.id}-card`);
    expect(shawarma).toMatchObject({ permalink: SHAWARMA_REEL.permalink });
    expect(cards.filter((item) => item.permalink === undefined).length).toBeGreaterThan(0);
  });
});
