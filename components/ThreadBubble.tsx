import { Lock } from "lucide-react";
import { copy } from "@/lib/ui/copy";
import type { ThreadLine } from "@/lib/ui/thread";
import { SenderChip } from "./SenderChip";

type Props = {
  line: ThreadLine;
  /** True for the first bubble of a run (see startsRun): the chip shows above it, and only above it. */
  showSender: boolean;
};

/**
 * One line of the thread. The person's own sit right in blue; everyone else sits left, with the sender's chip above
 * the first bubble of a run. A Muse's private word to its own person is a quieter bubble marked "only you".
 */
export function ThreadBubble({ line, showSender }: Props) {
  const mine = line.sender.kind === "you";
  const tone = mine ? "bg-bubble-user" : line.onlyYou ? "bg-group text-muted" : line.sender.kind === "friend" ? "bg-surface shadow-float" : "bg-bubble-muse";
  return (
    <div className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      {showSender && !mine ? <SenderChip sender={line.sender} /> : null}
      <p className={`max-w-[78%] animate-fade-in rounded-bubble px-3.5 py-2.5 text-[16px] leading-[22px] ${tone}`}>{line.text}</p>
      {line.onlyYou ? (
        <span className="mt-1 flex items-center gap-1 pl-1 text-[11px] leading-4 text-muted">
          <Lock className="size-3" strokeWidth={1.75} aria-hidden="true" />
          {copy.threadTagOnlyYou}
        </span>
      ) : null}
    </div>
  );
}
