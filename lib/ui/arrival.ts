import { SHAWARMA_REEL } from "@/lib/seed/past-signals";
import type { ChatItem } from "./chat";

/*
 * The reel arriving live after onboarding. On the judge's own phone, once Done is tapped, Michelle's reel is not
 * sitting preloaded above the fold: it arrives as a new message (the card, then "we should go!"), and the run starts
 * a beat after, so the exchange between the Muses happens in view. These are the rules, pure, so they are tested
 * without a clock; the screen owns the timers. The older shares stay where they were, and a reload or the stage
 * (no onboarding) never plays any of it.
 */

/** Nothing shown yet, the card shown, the reply shown, and the signal sent (the run is on its way). */
export type ArrivalStage = 0 | 1 | 2 | 3;

/** When each beat lands, in milliseconds after Done. */
export const ARRIVAL_AT_MS: Readonly<Record<Exclude<ArrivalStage, 0>, number>> = { 1: 800, 2: 1800, 3: 2800 };

/** How long the arrival keeps the start cards away if no plan shows up (a Reset in another tab, a lost reply). */
export const ARRIVAL_LINGER_MS = 15_000;

const REEL = SHAWARMA_REEL.id;
const FIRST_BEAT = [`sep-${REEL}`, `${REEL}-line`, `${REEL}-card`];
const SECOND_BEAT = [`${REEL}-reply`];

/** The chat items that wait for a beat: the reel's day, who sent it and the card, then the person's own reply. */
export const ARRIVING_ITEM_IDS: readonly string[] = [...FIRST_BEAT, ...SECOND_BEAT];

/**
 * The chat with the arrival applied. `stage` null is no arrival at all (everything is there, as before). Until the plan
 * exists the start cards are held back too: the run starts by itself, and a button to start it would be a second ask.
 */
export function withReelArrival(items: ChatItem[], stage: ArrivalStage | null, hasPlan: boolean): ChatItem[] {
  if (stage === null) return items;
  const waiting = stage < 1 ? ARRIVING_ITEM_IDS : stage < 2 ? SECOND_BEAT : [];
  return items.filter((item) => !waiting.includes(item.id) && (hasPlan || (item.kind !== "start-card" && item.kind !== "contact-entry")));
}
