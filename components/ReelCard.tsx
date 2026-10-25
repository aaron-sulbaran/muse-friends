"use client";

import { Clapperboard, Film, MapPin, Play } from "lucide-react";
import { useState } from "react";
import { instagramEmbedUrl } from "@/lib/ui/reel";
import { InstagramGlyph } from "./marks/InstagramGlyph";

type ReelCardProps = {
  image?: string;
  poster: string;
  /** The poster's real profile picture, for a reel read live from their own Instagram. The letter circle is the fallback. */
  posterImage?: string;
  caption: string;
  place: string;
  align: "left" | "right";
  label?: string;
  /** The reel's address. An instagram.com reel adds a "View on Instagram" link; any other value shows no link. */
  permalink?: string;
};

/**
 * A reel shared in a chat, as a compact card in the spirit of a DM share: handle, thumbnail with a play glyph,
 * a clamped caption, the provenance label and (for an instagram.com permalink) a link out. About 290px tall at
 * most, so it never takes over the chat. With no image the thumbnail is the seeded gradient and emoji.
 */
export function ReelCard({ image, poster, posterImage, caption, place, align, label = "Sample reel", permalink }: ReelCardProps) {
  const link = instagramEmbedUrl(permalink);
  const [pictureFailed, setPictureFailed] = useState(false);
  return (
    <div className={`flex ${align === "right" ? "justify-end" : "justify-start"}`}>
      <figure className="max-h-[320px] w-[208px] animate-fade-in overflow-hidden rounded-card bg-group">
        <div className="flex items-center gap-2 px-3 py-2">
          {posterImage && !pictureFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={posterImage} alt={poster} referrerPolicy="no-referrer" onError={() => setPictureFailed(true)} className="size-6 shrink-0 rounded-full object-cover" />
          ) : (
            <span
              aria-hidden
              className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 via-rose-500 to-fuchsia-600 text-[11px] font-semibold uppercase text-white"
            >
              {poster.charAt(0)}
            </span>
          )}
          <span className="truncate text-[13px] font-semibold leading-[18px]">{poster}</span>
        </div>
        <div className="relative h-[132px] w-full overflow-hidden bg-grey-disc">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={`${label}: ${place}`} referrerPolicy="no-referrer" className="size-full object-cover" />
          ) : (
            <div
              role="img"
              aria-label={`Sample reel of ${place}`}
              className="flex size-full items-center justify-center bg-gradient-to-br from-amber-200 via-orange-300 to-rose-400"
            >
              <Film aria-hidden className="size-12 text-white/90" strokeWidth={1.5} />
            </div>
          )}
          <span className="absolute left-1/2 top-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45">
            <Play aria-hidden className="size-4 fill-white text-white" />
          </span>
          <Clapperboard aria-hidden className="absolute right-2 top-2 size-4 text-white drop-shadow" />
        </div>
        <figcaption className="flex flex-col gap-1.5 px-3 pb-3 pt-2">
          <p className="line-clamp-3 text-[13px] leading-[18px]">{caption}</p>
          <p className="flex items-center gap-1 text-[12px] font-semibold leading-[16px]">
            <MapPin aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{place}</span>
          </p>
          <p className="text-[11px] leading-[14px] text-muted">{label}</p>
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[12px] font-semibold leading-[16px] text-accent-dot"
            >
              <InstagramGlyph />
              View on Instagram
            </a>
          ) : null}
        </figcaption>
      </figure>
    </div>
  );
}
