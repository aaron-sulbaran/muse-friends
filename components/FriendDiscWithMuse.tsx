import { PersonDisc } from "./PersonDisc";

type Props = {
  /** The friend's letter, on a grey disc: people are never drawn as Muses. */
  initial: string;
  /** The friend's Muse, peeking out from behind the disc and waving. Null shows the disc alone. */
  museModel: "mochi" | null;
  /** The disc's diameter; the peek scales with it. */
  size?: number;
};

const PEEK_ART = { mochi: "/avatars/mochi-peek-wave.webp" } as const;

// Measured on the 44px disc: the art shows at 55 by 48, its left edge 8px inside the disc's right edge, bottoms aligned.
const DISC = 44;
const PEEK = { width: 55, height: 48, overlap: 8 };

/**
 * A friend's profile disc with their Muse peeking from behind its right edge, so the judge sees that their Muse talks
 * to a friend's Muse. The disc and its white ring sit on top; the Muse is behind.
 */
export function FriendDiscWithMuse({ initial, museModel, size = DISC }: Props) {
  const disc = <PersonDisc name={initial} size={size} className="ring-[3px] ring-surface" />;
  if (museModel === null) return disc;
  const scale = size / DISC;
  const peek = { width: PEEK.width * scale, height: PEEK.height * scale, overlap: PEEK.overlap * scale };
  return (
    <span className="relative inline-block" style={{ width: size - peek.overlap + peek.width, height: Math.max(size, peek.height) }}>
      {/* A fixed brand render at its native aspect; next/image would only re-encode it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={PEEK_ART[museModel]}
        alt=""
        draggable={false}
        className="absolute bottom-0 select-none"
        style={{ left: size - peek.overlap, width: peek.width, height: peek.height }}
      />
      <span className="absolute bottom-0 left-0 z-10 inline-flex">{disc}</span>
    </span>
  );
}
