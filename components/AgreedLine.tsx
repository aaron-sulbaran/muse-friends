type Props = { first: string; second: string; count: number; onOpen: () => void };

/** One quiet line under the plan card: who agreed, in how many messages, and a way into the Activity view. */
export function AgreedLine({ first, second, count, onOpen }: Props) {
  return (
    <p className="text-[13px] leading-[18px] text-muted">
      {first} and {second} agreed in {count} {count === 1 ? "message" : "messages"} ·{" "}
      <button type="button" onClick={onOpen} className="font-semibold text-accent hover:underline">
        See how
      </button>
    </p>
  );
}
