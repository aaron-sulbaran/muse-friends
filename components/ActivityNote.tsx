import { CalendarX, Film, MessageCircle, Shield, UserMinus, Users, type LucideIcon } from "lucide-react";
import { formatTimeWithSeconds } from "@/lib/ui/format";
import type { UiNote } from "@/lib/ui/types";

const kinds: Record<UiNote["kind"], { icon: LucideIcon; title: string; plain?: boolean }> = {
  caption_extracted: { icon: Film, title: "Read the reel caption" },
  thread_opened: { icon: MessageCircle, title: "Opened a thread" },
  policy_changed: { icon: Shield, title: "Changed sharing" },
  contact_chosen: { icon: Users, title: "Asked to follow up" },
  contact_refused: { icon: UserMinus, title: "Did not reach out", plain: true },
  busy_added: { icon: CalendarX, title: "Marked a time busy" },
  reel_source: { icon: Film, title: "Where the reel came from" },
};

/** A timeline row that is not a message: what the agents noticed or a person switched. Line icon in a tile, never an avatar. */
export function ActivityNote({ note }: { note: UiNote }) {
  const { icon: Icon, title, plain } = kinds[note.kind];
  return (
    <li className="animate-row-in">
      <div className="flex items-start gap-3 rounded-group px-3 py-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-tile bg-group">
          <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className={`text-[15px] font-semibold leading-5 ${plain ? "text-withheld" : ""}`}>{title}</span>
            <span className="shrink-0 text-[12px] leading-4 text-muted">{formatTimeWithSeconds(note.at)}</span>
          </span>
          <span className="mt-0.5 block text-[13px] leading-[18px] text-muted">{note.text}</span>
        </span>
      </div>
    </li>
  );
}
