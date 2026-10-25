import type { AgentId } from "@/lib/ui/types";

type Props = {
  agent: AgentId;
  /** A letter: show a grey initial disc instead of the character (the simulated friend, or a contact). */
  initial?: string | null;
  /** The Muse's name, for the accessible label. */
  name?: string;
  size?: number;
  className?: string;
};

function tintOf(variable: string): string {
  return `color-mix(in srgb, ${variable} 10%, white)`;
}

const eye = { fill: "var(--color-avatar-ink)" };
const mouth = { fill: "none", stroke: "var(--color-avatar-ink)", strokeWidth: 2, strokeLinecap: "round" } as const;

function Sprout() {
  return (
    <>
      <path d="M32 15c-1-5 1-9 6-11 1 5-1 9-6 11zM32 15c1-4-1-7-5-8-1 4 1 7 5 8z" style={{ fill: "var(--color-sprout-leaf)" }} />
      <path d="M32 14c11 0 18 9 18 22 0 14-8 22-18 22s-18-8-18-22c0-13 7-22 18-22z" style={{ fill: "var(--color-sprout)" }} />
      <circle cx="26" cy="35" r="2.6" style={eye} />
      <circle cx="38" cy="35" r="2.6" style={eye} />
      <path d="M28.5 41.5q3.5 3 7 0" style={mouth} />
    </>
  );
}

function Mochi() {
  return (
    <>
      <circle cx="17" cy="23" r="7" style={{ fill: "var(--color-mochi)" }} />
      <circle cx="47" cy="23" r="7" style={{ fill: "var(--color-mochi)" }} />
      <path d="M32 20c14 0 23 9 23 20 0 12-10 18-23 18S9 52 9 40c0-11 9-20 23-20z" style={{ fill: "var(--color-mochi)" }} />
      <circle cx="25" cy="38" r="2.6" style={eye} />
      <circle cx="39" cy="38" r="2.6" style={eye} />
      <path d="M29 44h6" style={mouth} />
    </>
  );
}

/** A Muse's character: a circle with a 10 percent tint of the body color and the character bottom-aligned. */
export function MuseAvatar({ agent, initial = null, name = "Muse", size = 44, className = "" }: Props) {
  if (agent === "lisa" && initial) {
    return (
      <span
        aria-hidden="true"
        className={`inline-grid shrink-0 place-items-center rounded-full bg-grey-disc font-semibold text-ink ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.42 }}
      >
        {initial}
      </span>
    );
  }
  const tint = tintOf(agent === "aaron" ? "var(--color-sprout)" : "var(--color-mochi)");
  return (
    <span
      className={`inline-block shrink-0 overflow-hidden rounded-full ${className}`}
      style={{ width: size, height: size, backgroundColor: tint }}
    >
      <svg viewBox="0 0 64 64" width={size} height={size} role="img" aria-label={name} className="block" style={{ marginTop: size * 0.06 }}>
        {agent === "aaron" ? <Sprout /> : <Mochi />}
      </svg>
    </span>
  );
}
