"use client";

import { useSyncExternalStore } from "react";

function subscribeTo(query: string) {
  return (onChange: () => void) => {
    const list = window.matchMedia(query);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  };
}

/** Subscribes to a CSS media query. Renders `false` on the server and corrects after hydration. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribeTo(query),
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * Like useMediaQuery, but `null` until the browser has answered, so a page that swaps whole layouts can
 * render nothing for that first moment instead of flashing the wrong one.
 */
export function useMediaQueryKnown(query: string): boolean | null {
  return useSyncExternalStore<boolean | null>(
    subscribeTo(query),
    () => window.matchMedia(query).matches,
    () => null,
  );
}
