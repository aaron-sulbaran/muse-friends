"use client";

import { useSyncExternalStore } from "react";
import { useMediaQueryKnown } from "@/lib/ui/use-media-query";
import { PhoneEntry } from "./PhoneEntry";
import { Stage } from "./Stage";

const DESIGN_W = 1440;
const DESIGN_H = 900;

function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function viewportKey() {
  return `${window.innerWidth}x${window.innerHeight}`;
}

/** The viewport as "WxH", a string so useSyncExternalStore sees a stable snapshot between resizes. */
function useViewport(): { w: number; h: number } {
  const key = useSyncExternalStore(subscribeResize, viewportKey, () => `${DESIGN_W}x${DESIGN_H}`);
  const [w, h] = key.split("x").map(Number);
  return { w, h };
}

/** Below 1024px a laptop window still gets all three panes: a fixed design box scaled to fit, centered on the stage gradient. */
function ScaledStage() {
  const { w, h } = useViewport();
  const scale = Math.min(w / DESIGN_W, h / DESIGN_H);
  return (
    <div className="fixed inset-0 overflow-hidden bg-linear-to-b from-surface to-stage-end">
      <div
        style={
          {
            "--stage-h": `${DESIGN_H}px`,
            width: DESIGN_W,
            height: DESIGN_H,
            left: (w - DESIGN_W * scale) / 2,
            top: (h - DESIGN_H * scale) / 2,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          } as React.CSSProperties
        }
        className="absolute">
        <Stage />
      </div>
    </div>
  );
}

/**
 * The root page shows the laptop stage (both phones and the Activity panel side by side) on every laptop and
 * desktop window: fluid from 1024px up, scaled down to fit below that. Only a real phone (coarse pointer and a
 * narrow screen) is sent straight to its own Muse, with no side to choose. Nothing renders until the browser
 * has said which, so neither side flashes the wrong layout.
 */
export function Home() {
  const phone = useMediaQueryKnown("(pointer: coarse) and (max-width: 767px)");
  const wide = useMediaQueryKnown("(min-width: 1024px)");
  if (phone === null || wide === null) return <div className="min-h-dvh bg-linear-to-b from-surface to-stage-end" />;
  if (phone) return <PhoneEntry />;
  return wide ? <Stage /> : <ScaledStage />;
}
