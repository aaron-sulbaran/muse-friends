import type { Sender, ThreadLine } from "@/lib/ui/thread";
import { SenderChip, SenderPicture } from "./SenderChip";
import { fillFor } from "./ThreadBubble";

type Props = {
  line: ThreadLine;
  /** True when the Muse did not just speak: the chip shows above the bubble, as for any run. */
  showSender: boolean;
};

/** The ThreadLine a typing item stands for, so the run logic (chip once, picture at the end) treats it like a message. */
export function typingLine(sender: Sender): ThreadLine {
  return { id: "thread-typing", sender, text: "" };
}

/**
 * A Muse writing its next message: three dots in that Muse's own tint, with its chip above and its picture beside, like
 * the message that replaces it. Always the last of its run, so the picture is always there.
 */
export function ThreadTyping({ line, showSender }: Props) {
  const { sender } = line;
  return (
    <div role="status" aria-label={`${sender.name} is typing`}>
      {showSender ? <SenderChip sender={sender} /> : null}
      <div className="flex items-end gap-2">
        <div className="w-6 shrink-0">
          <SenderPicture sender={sender} />
        </div>
        <span className={`flex animate-fade-in gap-1 rounded-[18px] px-4 py-3.5 ${fillFor(sender)}`}>
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="size-1.5 animate-typing rounded-full bg-muted" style={{ animationDelay: `${dot * 150}ms` }} />
          ))}
        </span>
      </div>
    </div>
  );
}
