import { Lock } from "lucide-react";
import { copy } from "@/lib/ui/copy";
import type { UiSource } from "@/lib/ui/types";
import { SourceChips } from "./SourceChips";

/** A Muse's note to its own person, inside the shared thread: white, dashed, and said to be for you alone. A searched answer shows its sources under the text. */
export function PrivateAside({ children, sources }: { children?: React.ReactNode; sources?: UiSource[] }) {
  return (
    <div className="max-w-[78%] animate-fade-in rounded-[18px] border border-dashed border-aside-line bg-surface px-[13px] py-2">
      <p className="flex items-center gap-1 text-[11px] font-semibold leading-[14px] text-muted">
        <Lock className="size-[11px]" strokeWidth={2} aria-hidden="true" />
        {copy.threadOnlyYou}
      </p>
      <p className="text-[15px] leading-5">{children}</p>
      {sources && sources.length > 0 ? <SourceChips sources={sources} /> : null}
    </div>
  );
}
