import { Lock } from "lucide-react";
import { copy } from "@/lib/ui/copy";
import type { Sender, ThreadLine } from "@/lib/ui/thread";
import { PrivateAside } from "./PrivateAside";
import { SenderChip, SenderPicture } from "./SenderChip";

type Props = {
  line: ThreadLine;
  /** True for the first bubble of a run (see startsRun): the chip shows above it, and only above it. */
  showSender: boolean;
  /** True for the last bubble of a run (see endsRun): the sender's picture sits beside it, bottom aligned. */
  showPicture: boolean;
};

/** The fill says who is speaking without reading: blue is you, grey a person, and each Muse its own tint. */
export function fillFor(sender: Sender): string {
  if (sender.kind === "you") return "bg-bubble-user";
  if (sender.agent === "aaron") return "bg-bubble-sprout";
  if (sender.agent === "lisa") return "bg-bubble-mochi";
  if (sender.agent === "kai") return "bg-bubble-pebble";
  return "bg-bubble-muse";
}

/**
 * One line of the thread. Your own sit right in blue; everyone else sits left, with the chip above the first bubble
 * of a run and the picture beside the last. A Muse's private word to its own person is an aside, dashed and marked;
 * your own private question to your Muse is a dashed blue-edged bubble, labeled with who it went to.
 */
export function ThreadBubble({ line, showSender, showPicture }: Props) {
  const { sender } = line;
  if (sender.kind === "you") {
    return (
      <div className="flex flex-col items-end">
        {line.onlyYou && line.to ? (
          <p className="mb-[3px] flex items-center gap-1 pr-1 text-[11px] font-semibold leading-[14px] text-muted">
            <Lock className="size-[11px]" strokeWidth={2} aria-hidden="true" />
            {copy.threadToMuse(line.to)}
          </p>
        ) : null}
        <p
          className={`max-w-[78%] animate-fade-in px-[13px] py-[9px] text-[16px] leading-[21px] ${
            line.onlyYou ? "rounded-[18px] border border-dashed border-ask-line bg-surface" : "rounded-[18px] bg-bubble-user"
          }`}
        >
          {line.text}
        </p>
      </div>
    );
  }
  return (
    <div>
      {showSender ? <SenderChip sender={sender} /> : null}
      <div className="flex items-end gap-2">
        <div className="w-6 shrink-0">{showPicture ? <SenderPicture sender={sender} /> : null}</div>
        {line.onlyYou ? (
          <PrivateAside sources={line.sources}>{line.text}</PrivateAside>
        ) : (
          <p className={`max-w-[78%] animate-fade-in rounded-[18px] px-[13px] py-[9px] text-[16px] leading-[21px] ${fillFor(sender)}`}>{line.text}</p>
        )}
      </div>
    </div>
  );
}
