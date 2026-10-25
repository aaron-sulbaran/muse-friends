"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Replay } from "./replay";
import type { UiSnapshot } from "./types";

type ReplayResponse = { data: Replay | null; error: { message: string } | null };

export type ReplayScenario = "shawarma" | "trip";

async function fetchReplay(scenario: ReplayScenario): Promise<Replay> {
  const response = await fetch(scenario === "trip" ? "/api/replay?scenario=trip" : "/api/replay", { cache: "no-store" });
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
  const loading = useRef<Partial<Record<ReplayScenario, Promise<Replay | null>>>>({});

  // One fetch per scenario: the shawarma run is loaded ahead of time, the trip recording the first time it is asked for.
  const load = useCallback((scenario: ReplayScenario = "shawarma"): Promise<Replay | null> => {
    loading.current[scenario] ??= fetchReplay(scenario)
      .then((next) => {
        // Fetched ahead of time, the shawarma run is what a bare Replay press plays; a trip is shown only when it is asked for.
        if (scenario === "shawarma") setReplay((current) => current ?? next);
        return next;
      })
      .catch((failure: unknown) => {
        delete loading.current[scenario];
        setError(failure instanceof Error ? failure.message : "Could not load the replay");
        return null;
      });
    return loading.current[scenario]!;
  }, []);

  // Fetch ahead of time, so pressing Replay later does not wait on the network.
  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const start = useCallback(
    async (scenario: ReplayScenario = "shawarma") => {
      setError(null);
      const ready = await load(scenario);
      // Every load sets `replay`; playing another scenario means that one is the one on screen.
      if (ready) {
        setReplay(ready);
        setIndex(0);
      }
    },
    [load],
  );

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
