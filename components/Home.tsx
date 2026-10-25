"use client";

import { useMediaQueryKnown } from "@/lib/ui/use-media-query";
import type { Role } from "@/lib/ui/types";
import { PhoneChooser } from "./PhoneChooser";
import { Stage } from "./Stage";

/**
 * The root page picks its whole layout by screen width: the laptop stage (both phones and the Activity panel
 * side by side) from 1024px, and below that a one-screen chooser that leads to a single phone. Nothing renders
 * until the browser has said which, so a laptop never flashes the chooser and a phone never flashes the stage.
 */
export function Home({ sides }: { sides: Record<Role, string> }) {
  const wide = useMediaQueryKnown("(min-width: 1024px)");
  if (wide === null) return <div className="min-h-dvh bg-linear-to-b from-surface to-stage-end" />;
  return wide ? <Stage /> : <PhoneChooser sides={sides} />;
}
