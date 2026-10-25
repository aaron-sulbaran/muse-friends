/*
 * The reel card links out to the reel on Instagram. This is the gate in front of that link: only an instagram.com
 * reel (or post) address is normalised and shown; anything else, including the seed's example.com stand-in, gets
 * no link, so a bad value in a seed can never point the link somewhere else.
 */

const INSTAGRAM_MEDIA = /^https:\/\/(?:www\.)?instagram\.com\/(?:[A-Za-z0-9._]+\/)?(reels?|p|tv)\/([A-Za-z0-9_-]{5,40})\/?(?:[?#].*)?$/;

/** The canonical address for an instagram.com reel or post permalink, or null for any other address. */
export function instagramEmbedUrl(permalink: string | undefined): string | null {
  const match = permalink ? INSTAGRAM_MEDIA.exec(permalink.trim()) : null;
  if (!match) return null;
  const kind = match[1] === "reels" ? "reel" : match[1];
  return `https://www.instagram.com/${kind}/${match[2]}/`;
}
