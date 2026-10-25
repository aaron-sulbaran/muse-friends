import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_REEL_ID, getLiveReel, resetLiveReelCache } from "@/lib/instagram";
import { rawShawarmaSignal, recordedSnapshot } from "@/lib/seed/fixtures";
import { viewForRole } from "@/lib/ui/chat";
import { toUiSnapshot } from "@/lib/ui/snapshot";

const media = {
  id: DEMO_REEL_ID,
  media_type: "VIDEO",
  media_product_type: "REELS",
  caption: "Shawarma King is right by campus",
  permalink: "https://www.instagram.com/reel/Abc123/",
  thumbnail_url: `https://scontent.cdninstagram.com/${"x".repeat(560)}`,
  timestamp: "2026-10-16T15:04:18+0000",
  username: "owner.account",
};

function answer(body: unknown, ok = true) {
  return vi.fn<(url: string) => Promise<Response>>(async () => ({ ok, json: async () => body }) as Response);
}

describe("the demo reel, read live from its owner's Instagram", () => {
  beforeEach(() => {
    resetLiveReelCache();
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "test-token");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("asks for the pinned reel and maps Instagram's timestamp onto the protocol's", async () => {
    const fetchMock = answer(media);
    vi.stubGlobal("fetch", fetchMock);
    const reel = await getLiveReel(0);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`/${DEMO_REEL_ID}?fields=`);
    expect(reel).toMatchObject({ username: "owner.account", timestamp: "2026-10-16T15:04:18.000Z" });
    expect(reel?.thumbnail_url?.length).toBeGreaterThan(500);
  });

  it("caches for ten minutes, so the poll does not call Instagram every second", async () => {
    const fetchMock = answer(media);
    vi.stubGlobal("fetch", fetchMock);
    await getLiveReel(0);
    await getLiveReel(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await getLiveReel(11 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to the seeded reel with no token, an error, or a network failure", async () => {
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "");
    expect(await getLiveReel(0)).toBeNull();
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "test-token");
    vi.stubGlobal("fetch", answer({ error: { message: "expired" } }, false));
    expect(await getLiveReel(0)).toBeNull();
    resetLiveReelCache();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect(await getLiveReel(0)).toBeNull();
  });
});

describe("the chat shows the live reel when there is one", () => {
  it("swaps the seeded reel card for the owner's reel, labeled as live", async () => {
    const live = { ...rawShawarmaSignal().media, username: "owner.account", caption: "real caption", permalink: "https://www.instagram.com/reel/Abc123/" };
    const snapshot = toUiSnapshot(recordedSnapshot(), { mode: "live", liveReel: live });
    const card = viewForRole(snapshot, "a").items.find((item) => item.kind === "reel-card" && item.permalink === live.permalink);
    expect(card).toMatchObject({ poster: "owner.account", caption: "real caption", live: true });
  });

  it("keeps the seeded, fictional reel without one", () => {
    const snapshot = toUiSnapshot(recordedSnapshot(), { mode: "live" });
    expect(snapshot.reel).toBeNull();
    expect(viewForRole(snapshot, "a").items.some((item) => item.kind === "reel-card" && item.poster === "eastside.eats.atx")).toBe(true);
  });
});
