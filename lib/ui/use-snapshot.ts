"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pollIntervalMs } from "./tokens";
import type { UiSnapshot } from "./types";

async function loadSnapshot(): Promise<UiSnapshot> {
  const response = await fetch("/api/state", { cache: "no-store" });
  if (!response.ok) throw new Error(`State request failed with ${response.status}`);
  return (await response.json()) as UiSnapshot;
}

/** Polls /api/state every second. `connected` drops to false after a failed poll and recovers on the next good one. */
export function useSnapshot() {
  const [snapshot, setSnapshot] = useState<UiSnapshot | null>(null);
  const [connected, setConnected] = useState(true);
  const polling = useRef(false);

  const refresh = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    try {
      setSnapshot(await loadSnapshot());
      setConnected(true);
    } catch {
      setConnected(false);
    } finally {
      polling.current = false;
    }
  }, []);

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
