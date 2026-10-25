import { copy } from "@/lib/ui/copy";
import { listOf } from "@/lib/ui/format";

type Props = { names: string[]; count: number; onOpen: () => void };

/** One quiet line under the plan card: who agreed, in how many messages, that the two friends actually go, and a way into the Activity view. */
export function AgreedLine({ names, count, onOpen }: Props) {
  return (
    <p className="text-[13px] leading-[18px] text-muted">
      {copy.agreedLine(listOf(names), count)}{" "}
      <button type="button" onClick={onOpen} className="font-semibold text-accent hover:underline">
        {copy.agreedSeeHow}
      </button>
    </p>
  );
}
