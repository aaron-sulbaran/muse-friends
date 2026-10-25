"use client";

import { Clapperboard, MapPin, Play } from "lucide-react";
import { useCallback, useState } from "react";
import { instagramEmbedUrl } from "@/lib/ui/reel";
import { InstagramEmbed } from "./InstagramEmbed";

type ReelCardProps = {
  image?: string;
  poster: string;
  caption: string;
  place: string;
  align: "left" | "right";
  label?: string;
  /** The reel's address. An instagram.com reel shows as Instagram's own embed; any other value keeps this card. */
  permalink?: string;
};

type EmbedState = "loading" | "embedded" | "failed";

/**
 * A reel shared in a chat. With an instagram.com permalink it becomes the real reel through Instagram's public
 * embed, at the width of the chat; the plain card holds its place until the embed's frame appears, and stays if
 * it never does (offline Wi-Fi, a blocked script, a permalink that is not Instagram's).
 */
export function ReelCard({ permalink, ...card }: ReelCardProps) {
  const embedUrl = instagramEmbedUrl(permalink);
  const [state, setState] = useState<EmbedState>("loading");
  const onRendered = useCallback(() => setState("embedded"), []);
  const onFailed = useCallback(() => setState("failed"), []);

  if (!embedUrl || state === "failed") return <SampleReel {...card} />;
  return (
    <div className="relative">
      {/*
        While it loads, the embed sits invisibly over the card at the chat's full width. It must not be clipped or
        collapsed: a frame with no area on screen is never loaded, and Instagram sizes it against this width.
      */}
      <div className={state === "embedded" ? "animate-fade-in" : "pointer-events-none absolute left-0 top-0 w-full opacity-0"} aria-hidden={state !== "embedded"}>
        <InstagramEmbed url={embedUrl} onRendered={onRendered} onFailed={onFailed} />
      </div>
      {state === "loading" ? <SampleReel {...card} /> : null}
    </div>
  );
}

/** The card for a reel with no embed: styled in the spirit of a short-video share (original look). */
function SampleReel({ image, poster, caption, place, align, label = "Sample reel" }: Omit<ReelCardProps, "permalink">) {
  return (
    <div className={`flex ${align === "right" ? "justify-end" : "justify-start"}`}>
      <figure className="w-[200px] animate-fade-in overflow-hidden rounded-card bg-group">
        <div className="flex items-center gap-2 px-3 py-2">
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 via-rose-500 to-fuchsia-600 text-[11px] font-semibold uppercase text-white"
          >
            {poster.charAt(0)}
          </span>
          <span className="truncate text-[13px] font-semibold leading-[18px]">{poster}</span>
        </div>
        <div className="relative aspect-[9/16] w-full overflow-hidden bg-grey-disc">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt={`Sample reel of ${place}`} className="size-full object-cover" />
          ) : (
            <div
              role="img"
              aria-label={`Sample reel of ${place}`}
              className="flex size-full items-center justify-center bg-gradient-to-br from-amber-200 via-orange-300 to-rose-400 text-[64px]"
            >
              🎞️
            </div>
          )}
          <span className="absolute left-1/2 top-1/2 flex size-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45">
            <Play aria-hidden className="size-5 fill-white text-white" />
          </span>
          <Clapperboard aria-hidden className="absolute right-2 top-2 size-4 text-white drop-shadow" />
        </div>
        <figcaption className="flex flex-col gap-1.5 px-3 pb-3 pt-2">
          <p className="line-clamp-2 text-[13px] leading-[18px]">{caption}</p>
          <p className="flex items-center gap-1 text-[12px] font-semibold leading-[16px]">
            <MapPin aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{place}</span>
          </p>
          <p className="text-[11px] leading-[14px] text-muted">{label}</p>
        </figcaption>
      </figure>
    </div>
  );
}
