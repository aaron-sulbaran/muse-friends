"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Replay } from "./replay";
import type { UiSnapshot } from "./types";

type ReplayResponse = { data: Replay | null; error: { message: string } | null };

async function fetchReplay(): Promise<Replay> {
  const response = await fetch("/api/replay", { cache: "no-store" });
  const body = (await response.json().catch(() => null)) as ReplayResponse | null;
  if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? `Replay request failed with ${response.status}`);
  return body.data;
}

/**
 * Plays a recorded run on the client. The frames are fetched once, ahead of time,
 * and stepped through on timers, so a replay keeps playing if the network drops
 * after it has loaded. While it is on, `snapshot` stands in for the live one.
 */
export function useReplay() {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loading = useRef<Promise<Replay | null> | null>(null);

  const load = useCallback((): Promise<Replay | null> => {
    loading.current ??= fetchReplay()
      .then((next) => {
        setReplay(next);
        return next;
      })
      .catch((failure: unknown) => {
        loading.current = null;
        setError(failure instanceof Error ? failure.message : "Could not load the replay");
        return null;
      });
    return loading.current;
  }, []);

  // Fetch ahead of time, so pressing Replay later does not wait on the network.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const start = useCallback(async () => {
    setError(null);
    const ready = await load();
    if (ready) setIndex(0);
  }, [load]);

  const stop = useCallback(() => setIndex(null), []);

  useEffect(() => {
    if (index === null || !replay) return;
    if (index >= replay.frames.length - 1) return;
    const timer = setTimeout(() => setIndex((current) => (current === null ? null : current + 1)), replay.frames[index].holdMs);
    return () => clearTimeout(timer);
  }, [index, replay]);

  const active = index !== null && replay !== null;
  const snapshot: UiSnapshot | null = active ? replay.frames[index].snapshot : null;
  const finished = active && index >= replay.frames.length - 1;

  return { active, finished, snapshot, error, label: replay?.label ?? null, start, stop };
}
