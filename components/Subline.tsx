"use client";

import { useEffect, useRef, useState } from "react";
import { copy } from "@/lib/ui/copy";

const LOCKUP = "/brand/meta-lockup-primary-12px";

type Props = {
  /** The image already failed, for a header drawn after the fact. */
  imageFailed?: boolean;
};

/**
 * The line under the wordmark: "a proposal for Muse by" and the Meta lockup (D33), or just "a proposal for Muse" when
 * the image does not load. The lockup is the primary one, unaltered, sized by its letters: the "Meta" capitals (about
 * 8.5px) match the subtitle's, so it is 9 by 44, below Meta's 12px minimum symbol height (Aaron's call, so the subtitle
 * reads as a subtitle first). It sits 4 pixels after "by" on the baseline, with nothing after it on the line. It names who Muse belongs to, and says the idea is
 * a proposal for it; it never says Meta built or endorsed this.
 */
export function Subline({ imageFailed = false }: Props) {
  const [failed, setFailed] = useState(imageFailed);
  const image = useRef<HTMLImageElement>(null);

  // An image that failed before the page hydrated never reports it, so look once when it mounts.
  useEffect(() => {
    const element = image.current;
    if (element?.complete && element.naturalWidth === 0) setFailed(true);
  }, []);

  if (failed) return <span className="text-[12px] font-medium leading-[16px] text-muted">{copy.tagline}</span>;
  return (
    <span className="flex items-end gap-1 text-[12px] font-medium leading-[16px] text-muted">
      {copy.taglineBy}
      {/* The brand's own raster, cut to its ink at 2x and 3x; the official SVG embeds a 370 KB image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={image}
        src={`${LOCKUP}@3x.png`}
        srcSet={`${LOCKUP}@2x.png 2x, ${LOCKUP}@3x.png 3x`}
        alt={copy.metaAlt}
        height={9}
        width={44}
        onError={() => setFailed(true)}
        className="mb-px"
      />
    </span>
  );
}
