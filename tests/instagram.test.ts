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

const PICTURE = `https://scontent.cdninstagram.com/v/t51/${"p".repeat(300)}.jpg`;

/** The reel by its id and the owner's profile by /me, the way Instagram answers each; either can be made to fail. */
function instagram(options: { profile?: unknown; profileOk?: boolean; profileThrows?: boolean } = {}) {
  return vi.fn<(url: string) => Promise<Response>>(async (url) => {
    if (String(url).includes("/me?")) {
      if (options.profileThrows) throw new Error("offline");
      return { ok: options.profileOk ?? true, json: async () => options.profile ?? {} } as Response;
    }
    return { ok: true, json: async () => media } as Response;
  });
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
    // One pass is two requests, the reel and the owner's profile picture; the second poll asks neither.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await getLiveReel(11 * 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(4);
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

describe("the reel poster's profile picture, fetched in the same cached pass", () => {
  beforeEach(() => {
    resetLiveReelCache();
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "test-token");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("asks /me for username and profile_picture_url with the same token, and puts the picture on the reel", async () => {
    const fetchMock = instagram({ profile: { username: "owner.account", profile_picture_url: PICTURE } });
    vi.stubGlobal("fetch", fetchMock);
    const reel = await getLiveReel(0);
    const profileCall = fetchMock.mock.calls.map(([url]) => String(url)).find((url) => url.includes("/me?"));
    expect(profileCall).toContain("graph.instagram.com/v23.0/me?fields=username,profile_picture_url");
    expect(profileCall).toContain("access_token=test-token");
    expect(reel?.profile_picture_url).toBe(PICTURE);
    expect(reel?.username).toBe("owner.account");
  });

  it("keeps the reel and leaves the picture off when the profile has none", async () => {
    vi.stubGlobal("fetch", instagram({ profile: { username: "owner.account" } }));
    const reel = await getLiveReel(0);
    expect(reel).not.toBeNull();
    expect(reel?.profile_picture_url).toBeUndefined();
    resetLiveReelCache();
    vi.stubGlobal("fetch", instagram({ profile: { username: "owner.account", profile_picture_url: null } }));
    expect((await getLiveReel(0))?.profile_picture_url).toBeUndefined();
  });

  it("keeps the reel and leaves the picture off when the profile request fails, and never trusts a link that is not https", async () => {
    vi.stubGlobal("fetch", instagram({ profileOk: false, profile: { error: { code: 190 } } }));
    expect(await getLiveReel(0)).toMatchObject({ username: "owner.account" });
    resetLiveReelCache();
    vi.stubGlobal("fetch", instagram({ profileThrows: true }));
    const reel = await getLiveReel(0);
    expect(reel).toMatchObject({ username: "owner.account" });
    expect(reel?.profile_picture_url).toBeUndefined();
    resetLiveReelCache();
    vi.stubGlobal("fetch", instagram({ profile: { profile_picture_url: "javascript:alert(1)" } }));
    expect((await getLiveReel(0))?.profile_picture_url).toBeUndefined();
  });

  it("does not ask for a picture when the reel itself failed, so a failure still retries after a minute", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    expect(await getLiveReel(0)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("every Instagram failure falls back quietly, and is retried after a minute", () => {
  beforeEach(() => {
    resetLiveReelCache();
    vi.stubEnv("INSTAGRAM_ACCESS_TOKEN", "test-token");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    ["an expired token (OAuth error 190)", { status: 400, body: { error: { code: 190, message: "Session has expired" } } }],
    ["a rate limit", { status: 429, body: { error: { code: 4, message: "Application request limit reached" } } }],
    ["a reel that is not a reel any more", { status: 200, body: { id: "1", media_type: "IMAGE" } }],
  ])("%s", async (_name, { status, body }) => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: status === 200, status, json: async () => body }) as Response));
    expect(await getLiveReel(0)).toBeNull();
  });

  it("a timeout", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new DOMException("The operation timed out.", "TimeoutError"))));
    expect(await getLiveReel(0)).toBeNull();
  });

  it("asks again a minute after a failure, not ten", async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    await getLiveReel(0);
    await getLiveReel(30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await getLiveReel(61_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("the chat carries the poster's picture to the reel card", () => {
  it("passes the profile picture from the live reel, and none for the seeded one", () => {
    const live = { ...rawShawarmaSignal().media, username: "owner.account", caption: "real caption", permalink: "https://www.instagram.com/reel/Abc123/", profile_picture_url: PICTURE };
    const snapshot = toUiSnapshot(recordedSnapshot(), { mode: "live", liveReel: live });
    expect(snapshot.reel?.profilePictureUrl).toBe(PICTURE);
    expect(viewForRole(snapshot, "a").items.find((item) => item.kind === "reel-card" && item.live)).toMatchObject({ posterImage: PICTURE });
    const seeded = toUiSnapshot(recordedSnapshot(), { mode: "live" });
    expect(viewForRole(seeded, "a").items.some((item) => item.kind === "reel-card" && item.posterImage !== undefined)).toBe(false);
    const without = toUiSnapshot(recordedSnapshot(), { mode: "live", liveReel: { ...live, profile_picture_url: undefined } });
    expect(without.reel?.profilePictureUrl).toBeNull();
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
