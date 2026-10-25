import { copy } from "@/lib/ui/copy";
import type { Sender } from "@/lib/ui/thread";
import { MuseAvatar } from "./MuseAvatar";
import { PersonDisc } from "./PersonDisc";

/** The small tag after the name: whose Muse it is, or that the friend is played by a model. Null when the name says enough. */
export function senderTag(sender: Sender): string | null {
  switch (sender.kind) {
    case "your-muse":
      return copy.thread.tagYourMuse;
    case "friend-muse":
      return sender.owner ? copy.thread.tagFriendMuse(sender.owner) : null;
    case "friend":
    case "you":
      return sender.simulated ? copy.thread.tagSimulated : null;
  }
}

/** Who is speaking: a small picture (a Muse's own character, or a person's grey initial disc), the name, and the tag. */
export function SenderChip({ sender }: { sender: Sender }) {
  const tag = senderTag(sender);
  return (
    <div className="mb-1 flex items-center gap-1.5 pl-1 text-[12px] leading-4">
      {sender.agent ? <MuseAvatar agent={sender.agent} name={sender.name} size={20} /> : <PersonDisc name={sender.name} size={20} />}
      <span className="font-semibold text-ink">{sender.name}</span>
      {tag ? <span className="rounded-full bg-group px-1.5 py-px text-[11px] font-semibold leading-[14px] text-muted">{tag}</span> : null}
    </div>
  );
}
