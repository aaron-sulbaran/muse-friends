import { simulatedFriend } from "@/lib/ui/tokens";

type Props = {
  /** The person's name; the disc shows its first letter. */
  name: string;
  size?: number;
  className?: string;
};

/**
 * A person, never a Muse: a grey disc with their initial. Michelle, the simulated friend, is drawn this way so she never
 * looks like a real Muse, while her Muse (Mochi) keeps its own character art.
 */
export function PersonDisc({ name, size = 20, className = "" }: Props) {
  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center rounded-full bg-grey-disc font-semibold text-ink ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.5 }}
    >
      {name.charAt(0)}
    </span>
  );
}

/** Michelle's disc, for every place the simulated friend herself (not her Muse) is shown. */
export function SimulatedFriendDisc({ size, className }: Pick<Props, "size" | "className">) {
  return <PersonDisc name={simulatedFriend.human} size={size} className={className} />;
}
