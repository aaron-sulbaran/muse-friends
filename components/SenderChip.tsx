"use client";

import { useState } from "react";
import { copy } from "@/lib/ui/copy";
import type { Sender } from "@/lib/ui/thread";
import { MuseAvatar } from "./MuseAvatar";
import { PersonDisc } from "./PersonDisc";

/** Whose Muse it is, said from the reader's side: ", your Muse" or ", Michelle's Muse". Null for a person. */
export function museOwnerText(sender: Sender): string | null {
  if (sender.kind === "your-muse") return copy.threadYourMuse;
  if (sender.kind === "friend-muse") return sender.owner ? copy.threadMuseOf(sender.owner) : null;
  return null;
}

/** The small picture beside the last bubble of a run: a Muse's own character, or a person's grey initial. */
export function SenderPicture({ sender }: { sender: Sender }) {
  return sender.agent ? <MuseAvatar agent={sender.agent} name={sender.name} size={24} /> : <PersonDisc name={sender.name} size={24} />;
}

/**
 * Who is speaking, above the first bubble of a run: the name in bold, then for a Muse its owner in plain muted text
 * after a comma. A person played by a model carries a "Simulated" tag, and tapping it says so in a line.
 */
export function SenderChip({ sender }: { sender: Sender }) {
  const [explained, setExplained] = useState(false);
  const owner = museOwnerText(sender);
  return (
    <div className="mb-[3px] pl-8 text-[12px] leading-4">
      <span className="font-semibold text-ink">{sender.name}</span>
      {owner ? <span className="text-muted">, {owner}</span> : null}
      {sender.simulated ? (
        <button
          type="button"
          aria-expanded={explained}
          onClick={() => setExplained((open) => !open)}
          className="ml-1.5 rounded-full bg-group px-1.5 py-px align-middle text-[10px] font-semibold leading-[14px] text-muted"
        >
          {copy.threadSimulated}
        </button>
      ) : null}
      {explained ? (
        <span role="status" className="mt-1 block rounded-group bg-group px-2.5 py-1.5 text-[12px] leading-4 text-muted">
          {copy.threadSimulatedCard(sender.name)}
        </span>
      ) : null}
    </div>
  );
}
