"use client";

import { useEffect, useState } from "react";
import { TRIP_BOOKING_STEP_MS, TRIP_BOOKING_STEPS } from "./group";
import type { UiPlan } from "./types";

/** A beat after "All three of you are in" before Sprout starts booking, so that line is read first. */
const FIRST_STEP_MS = 1_500;

/**
 * Paces the trip's booking on one phone once all three are in: the flight, the hotel, the dates, the days, then the
 * wrap-up, one step every TRIP_BOOKING_STEP_MS. Nobody has to tap anything. Returns how many steps to show now.
 */
export function useTripBooking(plan: UiPlan | null): number {
  const key = plan?.kind === "trip" && plan.state === "confirmed" && plan.trip?.itinerary ? plan.id : null;
  const [run, setRun] = useState<{ key: string; steps: number } | null>(null);

  useEffect(() => {
    if (!key) return;
    let steps = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      steps += 1;
      setRun({ key, steps });
      if (steps < TRIP_BOOKING_STEPS) timer = setTimeout(tick, TRIP_BOOKING_STEP_MS);
    };
    timer = setTimeout(tick, FIRST_STEP_MS);
    return () => clearTimeout(timer);
  }, [key]);

  return run && run.key === key ? run.steps : 0;
}
