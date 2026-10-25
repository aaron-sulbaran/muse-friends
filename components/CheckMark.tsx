/**
 * Muse's check mark: a blue ring with a heavier blue tick, read from Muse's own "done" marks (kb/design/marks). It is the
 * one check on the site: every done state (a draft handed off, a calendar hold taken, a goal reached, a deposit in, a line
 * you said yes to) draws this and nothing else, so the color and shape change in one place. It draws in, the ring and
 * then the tick, and is shown already drawn under reduced motion. The size is the caller's (16px beside 13 to 15px text,
 * 12px as a badge, 20px in a heading row); the blue is not. Never green, never filled.
 */
export const CHECK_BLUE = "#0058DC";

type Props = {
  className?: string;
  /** Accepted so it can stand in for an icon that takes one; the ring and the tick keep Muse's own strokes. */
  strokeWidth?: number;
};

export function CheckMark({ className = "size-4" }: Props) {
  return (
    <svg data-mark="check" viewBox="0 0 24 24" fill="none" stroke={CHECK_BLUE} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 ${className}`}>
      <circle className="muse-check-ring" cx="12" cy="12" r="9.75" strokeWidth={2.1} pathLength={1} />
      <path className="muse-check-tick" d="M7.6 12.4l3.1 3.1 5.8-6.3" strokeWidth={2.6} pathLength={1} />
    </svg>
  );
}
