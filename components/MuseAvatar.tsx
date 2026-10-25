"use client";

import { useEffect } from "react";
import { simulatedFriend } from "@/lib/ui/tokens";
import type { AgentId, AvatarMood } from "@/lib/ui/types";

type Props = {
  agent: AgentId;
  /** True when side b is played by the simulated friend; shows a grey initial disc instead of a character. */
  simulated?: boolean;
  /** The Muse's name, for the accessible label. */
  name?: string;
  /** Rendered height in pixels. The renders are made for 36 (rows and cards) and 44 (the header), never above 96. */
  size?: number;
  /** Set on the phone header: the animated loop for what this Muse is doing. Left out, the avatar is the static portrait. */
  mood?: AvatarMood;
  className?: string;
};

const characterOf: Record<AgentId, string> = { aaron: "sprout", lisa: "mochi" };
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
 * mood (a still frame under reduced motion); everywhere else is the static portrait. Michelle, the simulated friend,
 * keeps a grey initial disc so she never looks like a real Muse.
 */
export function MuseAvatar({ agent, simulated = false, name = "Muse", size = 44, mood, className = "" }: Props) {
  useEffect(() => {
    if (mood) preloadLoops();
  }, [mood]);

  if (agent === "lisa" && simulated) {
    return (
      <span
        aria-hidden="true"
        className={`inline-grid shrink-0 place-items-center rounded-full bg-grey-disc font-semibold text-ink ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.42 }}
      >
        {simulatedFriend.human.charAt(0)}
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
