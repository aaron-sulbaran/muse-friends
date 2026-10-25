import { copy } from "./copy";
import { formatWindowSpoken, namesFor } from "./format";
import type { PhoneStatus } from "./chat";
import type { UiReelRead, UiSnapshot } from "./types";

/*
 * The opening moment after onboarding (D26, screen 4), as data: what the judge's chat shows once the reel has
 * arrived, in the order it shows it. The agents talk first, so the reel and Sprout's read appear as soon as they exist,
 * and the offer only once the Muses have agreed (`awaiting_humans`): nothing is faked to look instant. Pure, so the
 * ordering rules are tested without rendering; wiring it into the chat is a later step.
 */

export type OpeningMoment = {
  /** The 12px line above the reel: who sent it. */
  senderLine: string;
  /** The reel card is the compact 80 by 134 when there is no live embed, so the whole moment fits one screen. */
  reel: { compact: boolean; live: boolean };
  /** The 11px line under a live reel, so a teammate's real reel is never presented as a friend's. */
  teammateLine: string | null;
  /** Sprout's read of the caption, once the model has read it. */
  read: string | null;
  /** The offer bubble, only once the Muses have agreed on a time. */
  offer: string | null;
  /** The plan card, with the friend's Muse already in; only once the offer exists. */
  plan: { title: string; museIsIn: string; notNow: string; setItUp: string } | null;
  /** [talking] while the Muses work, [waiting-you] once the card is yours; null otherwise. */
  status: PhoneStatus | null;
};

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`.replace(/[.\s]+$/, "");

/** "Shawarma Point on Eastside. Open until 9, closed Sundays." from whichever fields the model found; null with no place. */
export function readLine(read: UiReelRead | null): string | null {
  if (!read?.place) return null;
  const where = read.area ? `${read.place} on ${read.area}` : read.place;
  return read.hours ? `${where}. ${sentence(read.hours)}.` : `${where}.`;
}

/** What the judge's phone shows, on the side of the person who is onboarding (side a), with the room's friend named. */
export function openingMoment(snapshot: UiSnapshot, friendName: string): OpeningMoment {
  const names = namesFor(snapshot);
  const plan = snapshot.plan;
  const live = snapshot.reel !== null;
  const agreed = plan?.state === "awaiting_humans" && plan.window !== null;
  const mine = plan?.decisions.a ?? "pending";

  let status: PhoneStatus | null = null;
  if (plan && (plan.state === "detected" || plan.state === "negotiating")) status = { glyph: "talking", text: copy.statusTalking(names.muse.lisa) };
  else if (agreed && mine === "pending") status = { glyph: "waiting-you", text: copy.statusWaitingYou };

  return {
    senderLine: copy.openingSenderLine(friendName),
    reel: { compact: !live, live },
    teammateLine: live ? copy.openingTeammateReel : null,
    read: readLine(snapshot.reelRead),
    offer: agreed && plan?.window ? copy.openingOffer(friendName, formatWindowSpoken(plan.window)) : null,
    plan: agreed && plan ? { title: copy.openingPlanTitle(plan.activityTitle, friendName), museIsIn: copy.friendIsIn(names.muse.lisa), notNow: copy.declineA, setItUp: copy.openingSetItUp } : null,
    status,
  };
}
