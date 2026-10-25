import type { InFlight } from "./types";

/** A running call older than this is not believed: the count would only mislead. */
const MAX_COUNT_MS = 10 * 60 * 1000;

/**
 * When the running call started, as a time in milliseconds, from the snapshot's `since` for each running agent (an ISO
 * time per agent id): the earliest of them when more than one Muse is running. Undefined when the snapshot does not say,
 * and the row counts from the first poll that showed the call instead. A time in the future, or minutes ago, is not
 * trusted.
 */
export function inFlightSince(flight: InFlight | null | undefined, now: number): number | undefined {
  const since = flight?.since;
  if (!flight || typeof since !== "object" || since === null) return undefined;
  const started = flight.agents.flatMap((agent) => {
    const time = typeof since[agent] === "string" ? Date.parse(since[agent]!) : Number.NaN;
    return Number.isFinite(time) && time <= now && now - time <= MAX_COUNT_MS ? [time] : [];
  });
  return started.length > 0 ? Math.min(...started) : undefined;
}
