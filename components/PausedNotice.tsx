import { copy } from "@/lib/ui/copy";

type Props = {
  text: string;
  onBack: () => void;
  className?: string;
};

/** Live runs are capped to bound the credits. Past the cap the page plays a recording and says so, with a way back. */
export function PausedNotice({ text, onBack, className = "" }: Props) {
  return (
    <div role="status" className={`flex items-center justify-between gap-3 rounded-full bg-surface px-4 py-2 text-[13px] font-semibold shadow-float ${className}`}>
      <span>{text}</span>
      <button type="button" onClick={onBack} className="shrink-0 rounded-full bg-group px-3 py-1 transition-colors hover:bg-bubble-muse">
        {copy.pausedBack}
      </button>
    </div>
  );
}
