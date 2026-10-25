"use client";

import { useEffect } from "react";
import type { AvatarMood, MemberId } from "@/lib/ui/types";

type Props = {
  agent: MemberId;
  /** The Muse's name, for the accessible label. */
  name?: string;
  /** Rendered height in pixels. The renders are made for 36 (rows and cards) and 44 (the header), never above 96. */
  size?: number;
  /** Set on the phone header: the animated loop for what this Muse is doing. Left out, the avatar is the static portrait. */
  mood?: AvatarMood;
  className?: string;
};

const characterOf = { aaron: "sprout", lisa: "mochi" } as const;
const moods: AvatarMood[] = ["idle", "thinking", "talking"];

let preloaded = false;

/** Fetches every loop once, so a change of mood swaps from the cache instead of flashing empty. */
function preloadLoops() {
  if (preloaded) return;
  preloaded = true;
  for (const character of Object.values(characterOf)) {
    for (const mood of moods) new Image().src = `/avatars/${character}-${mood}.webp`;
  }
}

/**
 * A Muse's character: Blender renders of Sprout and Mochi, bare, no circle and no tile. The header gets the loop for its
 * mood (a still frame under reduced motion); everywhere else is the static portrait. Mochi is Michelle's Muse too, so
 * the simulated friend's side shows Mochi; Michelle herself, the person, is a PersonDisc.
 */
export function MuseAvatar({ agent, name = "Muse", size = 44, mood, className = "" }: Props) {
  useEffect(() => {
    if (mood) preloadLoops();
  }, [mood]);

  if (agent === "kai") {
    // Pebble, the third friend of a group plan, has no render yet: an initial on a warm stone disc, never Michelle's grey.
    return (
      <span
        aria-label={name}
        role="img"
        className={`inline-grid shrink-0 place-items-center rounded-full bg-pebble font-semibold text-ink ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.42 }}
      >
        {name.charAt(0)}
      </span>
    );
  }

  const character = characterOf[agent];
  const image = (src: string) => (
    // Fixed brand renders at their native size; next/image would only re-encode the animated loops.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={name} width={size} height={size} draggable={false} className={`block shrink-0 select-none object-contain ${className}`} style={{ width: size, height: size }} />
  );

  if (!mood) return image(`/avatars/${character}-portrait.png`);
  return (
    <picture>
      <source media="(prefers-reduced-motion: reduce)" srcSet={`/avatars/${character}-${mood}-header.png`} />
      {image(`/avatars/${character}-${mood}.webp`)}
    </picture>
  );
}
