import { ReelMedia } from "@/lib/protocol";

/*
 * Server-only: the demo's reel, read live from its owner's Instagram account through the Instagram Graph API
 * (Instagram API with Instagram Login). The owner authorized the app and made the token themselves; the
 * reel is their own. Without INSTAGRAM_ACCESS_TOKEN, or when the call fails, everything falls back to the
 * seeded, fictional reel, so a run never waits on Instagram.
 */

const GRAPH = "https://graph.instagram.com/v23.0";
const FIELDS = "id,media_type,media_product_type,caption,permalink,thumbnail_url,timestamp,username";
/** The owner's Shawarma King reel. INSTAGRAM_REEL_ID picks another of their reels. */
export const DEMO_REEL_ID = "18025507859870759";

const TTL_MS = 10 * 60 * 1000;
/** After a failure, wait this long before asking Instagram again. */
const RETRY_MS = 60 * 1000;
const TIMEOUT_MS = 5000;

let cached: { reel: ReelMedia | null; until: number } | null = null;

export async function getLiveReel(now = Date.now()): Promise<ReelMedia | null> {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) return null;
  if (cached && now < cached.until) return cached.reel;
  const reel = await fetchReel(token, process.env.INSTAGRAM_REEL_ID || DEMO_REEL_ID);
  cached = { reel, until: now + (reel ? TTL_MS : RETRY_MS) };
  return reel;
}

/** Tests only: forget the cached reel. */
export function resetLiveReelCache(): void {
  cached = null;
}

async function fetchReel(token: string, id: string): Promise<ReelMedia | null> {
  try {
    const url = `${GRAPH}/${encodeURIComponent(id)}?fields=${FIELDS}&access_token=${encodeURIComponent(token)}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    if (!response.ok) return null;
    const media = (await response.json()) as Record<string, unknown>;
    // Instagram writes "2026-10-16T15:04:18+0000"; the protocol wants an offset with a colon.
    const timestamp = typeof media.timestamp === "string" ? new Date(media.timestamp).toISOString() : undefined;
    const parsed = ReelMedia.safeParse({ ...media, caption: media.caption ?? "", timestamp });
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
