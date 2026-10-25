import type { InFlight } from "./types";

/** A running call older than this is not believed: the count would only mislead. */
const MAX_COUNT_MS = 10 * 60 * 1000;

/**
 * When the running call started, as a time in milliseconds, when the snapshot says so (`since`, an ISO time on the
 * in-flight record); undefined otherwise, and the row counts from the first poll that showed the call instead. A time
 * in the future, or minutes ago, is not trusted.
 */
export function inFlightSince(flight: InFlight | null | undefined, now: number): number | undefined {
  const since = (flight as { since?: unknown } | null | undefined)?.since;
  if (typeof since !== "string") return undefined;
  const started = Date.parse(since);
  if (!Number.isFinite(started) || started > now || now - started > MAX_COUNT_MS) return undefined;
  return started;
}
