"use client";

import { useState } from "react";
import { copy } from "@/lib/ui/copy";
import { ChatBubble } from "./ChatBubble";
import { CardShell, Pill } from "./CardShell";

/**
 * What opting out means, said plainly: what stops, what continues, what never happens. "Got it" folds the card into
 * the judge's own bubble. Nothing here pushes them back toward Friends.
 */
export function OptOutCard() {
  const [acknowledged, setAcknowledged] = useState(false);
  if (acknowledged) return <ChatBubble from="user">{copy.onboarding.gotIt}</ChatBubble>;
  return (
    <CardShell label={copy.onboarding.optOutTitle}>
      <h3 className="text-[17px] font-semibold leading-[22px]">{copy.onboarding.optOutTitle}</h3>
      <p className="mt-3 text-[15px] leading-[21px]">{copy.onboarding.optOutOff}</p>
      <p className="mt-2 text-[15px] leading-[21px]">{copy.onboarding.optOutNothingShared}</p>
      <Pill tone="grey" onClick={() => setAcknowledged(true)} className="mt-4 w-full">
        {copy.onboarding.gotIt}
      </Pill>
      <p className="mt-3 text-center text-[13px] leading-[18px] text-muted">{copy.onboarding.turnOnAnytime}</p>
    </CardShell>
  );
}

/** The one way back in after an opt-out: it opens the who step again. */
export function TurnOnFriendsPill({ onTurnOn }: { onTurnOn: () => void }) {
  return (
    <Pill tone="accent" onClick={onTurnOn}>
      {copy.onboarding.turnOn}
    </Pill>
  );
}
