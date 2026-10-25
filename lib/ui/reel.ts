/*
 * The Reels APIs cannot read a friend's reel, so a real reel on screen goes through Instagram's public embed:
 * a blockquote with the reel's permalink and one script. This is the gate in front of it. Only an instagram.com
 * reel (or post) address becomes an embed; anything else, including the seed's example.com stand-in, stays the
 * plain card, so a bad value in a seed can never point the embed script somewhere else.
 */

const INSTAGRAM_MEDIA = /^https:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9._]+\/)?(reels?|p|tv)\/([A-Za-z0-9_-]{5,40})\/?(?:[?#].*)?$/;

/** The canonical embed address for an instagram.com reel or post permalink, or null for any other address. */
export function instagramEmbedUrl(permalink: string | undefined): string | null {
  const match = permalink ? INSTAGRAM_MEDIA.exec(permalink.trim()) : null;
  if (!match) return null;
  const kind = match[1] === "reels" ? "reel" : match[1];
  return `https://www.instagram.com/${kind}/${match[2]}/`;
}

/** How long the embed gets to show a finished frame before the plain card stays. */
export const EMBED_RENDER_TIMEOUT_MS = 3000;

/** Instagram inserts its frame about 2px tall; anything taller than this means the reel's page has loaded. */
export const EMBED_MIN_FRAME_HEIGHT = 100;

export const INSTAGRAM_EMBED_SCRIPT = "https://www.instagram.com/embed.js";
