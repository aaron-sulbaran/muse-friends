import { Clapperboard, MapPin, Play } from "lucide-react";

type ReelCardProps = {
  image?: string;
  poster: string;
  caption: string;
  place: string;
  align: "left" | "right";
  label?: string;
};

/** A sample reel shared in a chat, styled in the spirit of a short-video share (original look). */
export function ReelCard({ image, poster, caption, place, align, label = "Sample reel" }: ReelCardProps) {
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
