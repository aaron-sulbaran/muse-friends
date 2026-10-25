import { UserRound } from "lucide-react";
import { copy } from "@/lib/ui/copy";
import type { MemberId } from "@/lib/ui/types";

type Props = {
  planId: string;
  member: MemberId;
  name: string;
};

/**
 * Kai (Pebble's person) is fictional and has no phone, so nobody answers for them from another person's screen: a model
 * plays them, and the answer shows up here, and in Activity, when it lands. The card is read-only on purpose, and says so.
 */
export function MemberCard({ name }: Props) {
  return (
    <section className="max-w-[92%] animate-card-in rounded-card bg-surface p-5 shadow-float">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-tile bg-group">
          <UserRound className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-[17px] font-semibold leading-[22px]">{copy.memberDeciding(name)}</h3>
          <p className="mt-0.5 text-[13px] leading-[18px] text-muted">{copy.memberPlayedByModel(name)}</p>
        </div>
      </div>
    </section>
  );
}
