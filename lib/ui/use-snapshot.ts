"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getRoom, stateUrl } from "./room";
import { pollIntervalMs } from "./tokens";
import type { Role, UiSnapshot } from "./types";

/** Returns null on 304: nothing changed since `etag`, so there is nothing to render. */
async function loadSnapshot(etag: string | null, role?: Role): Promise<{ snapshot: UiSnapshot; etag: string | null } | null> {
  const response = await fetch(stateUrl(getRoom(), role), {
    cache: "no-store",
    headers: etag ? { "If-None-Match": etag } : undefined,
  });
  if (response.status === 304) return null;
  if (!response.ok) throw new Error(`State request failed with ${response.status}`);
  return { snapshot: (await response.json()) as UiSnapshot, etag: response.headers.get("ETag") };
}

/**
 * Polls /api/state every second. `connected` drops to false after a failed poll and recovers on the next good one.
 * A phone passes its role, so it never receives what is private to the other side; the stage passes none.
 */
export function useSnapshot(role?: Role) {
  const [snapshot, setSnapshot] = useState<UiSnapshot | null>(null);
  const [connected, setConnected] = useState(true);
  const polling = useRef(false);
  const etag = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      const next = await loadSnapshot(etag.current, role);
      if (next) {
        etag.current = next.etag;
        setSnapshot(next.snapshot);
      }
      setConnected(true);
    } catch {
      setConnected(false);
    } finally {
      polling.current = false;
    }
  }, [role]);

  useEffect(() => {
    const first = setTimeout(refresh, 0);
    const timer = setInterval(refresh, pollIntervalMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  return { snapshot, connected, refresh };
}
