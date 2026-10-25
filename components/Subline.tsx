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
 * the image does not load. The lockup is the primary one, unaltered, at Meta's minimum 12 pixel symbol height, 4 pixels
 * after "by" and on the baseline, with nothing after it on the line. It names who Muse belongs to, and says the idea is
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

  if (failed) return <span className="text-[11px] font-medium leading-[14px] text-muted">{copy.tagline}</span>;
  return (
    <span className="flex items-end gap-1 text-[11px] font-medium leading-[14px] text-muted">
      {copy.taglineBy}
      {/* The brand's own raster, cut to its ink at 2x and 3x of a 12 pixel symbol; the official SVG embeds a 370 KB image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={image}
        src={`${LOCKUP}@3x.png`}
        srcSet={`${LOCKUP}@2x.png 2x, ${LOCKUP}@3x.png 3x`}
        alt={copy.metaAlt}
        height={12}
        width={59}
        onError={() => setFailed(true)}
        className="mb-[-1.5px]"
      />
    </span>
  );
}
