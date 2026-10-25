import { copy } from "@/lib/ui/copy";

/**
 * The lockup's numbers at a given font size: the header's (22px: a 23.4 by 65.8 ink-tight script, pushed 3.95px down so its
 * ink is centered on the capitals of "Friends", and 5px before it; from kb/design/wordmark/final) scaled together, so the
 * lockup keeps its proportions in a larger or smaller place.
 */
export function wordmarkMetrics(size: number): { height: number; width: number; top: number; gap: number } {
  const scale = size / 22;
  return { height: 23.4 * scale, width: 65.8 * scale, top: 3.95 * scale, gap: 5 * scale };
}

/**
 * Meta's blue script "Muse" and "Friends" in sans (D35), the same lockup as the stage header, sized for another place:
 * the /how cover, the settings sheet. It reads aloud as "Muse Friends" and is never recolored or redrawn.
 */
export function Wordmark({ size }: { size: number }) {
  const metrics = wordmarkMetrics(size);
  return (
    <span role="img" aria-label={copy.brand} className="inline-flex items-baseline whitespace-nowrap font-semibold leading-none tracking-[-0.01em]" style={{ fontSize: size }}>
      {/* The traced brand file in its own blue gradient (public/brand), then the word in sans. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/brand/muse-script-blue.svg"
        alt=""
        height={Math.round(metrics.height)}
        width={Math.round(metrics.width)}
        className="relative"
        style={{ height: metrics.height, width: metrics.width, top: metrics.top, marginRight: metrics.gap }}
      />
      Friends
    </span>
  );
}
