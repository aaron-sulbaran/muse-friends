"use client";

import { useEffect, useState } from "react";
import { formatElapsed } from "@/lib/ui/format";
import { inFlightSince } from "@/lib/ui/timers";
import type { InFlight } from "@/lib/ui/types";

type Props = {
  /** The running call, when the count follows one: it starts when the snapshot says the call started, if it says. */
  flight?: InFlight | null;
  /** Start the count this many seconds in, for a card drawn after the fact. */
  initialSeconds?: number;
};

/** "7 s", counting up each second from when the call started, or from when this mounted. Mount it only while the thing it counts is running. */
export function Elapsed({ flight, initialSeconds = 0 }: Props) {
  const [startedAt] = useState(() => inFlightSince(flight, Date.now()) ?? Date.now() - initialSeconds * 1000);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  return <span className="tabular-nums">{formatElapsed((now - startedAt) / 1000)}</span>;
}
