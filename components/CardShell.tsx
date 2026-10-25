type ShellProps = {
  /** The card's accessible name, usually its title. */
  label: string;
  children: React.ReactNode;
  className?: string;
};

/** The white checkout-style card every chat card sits in: rounded, floating, rising in. */
export function CardShell({ label, children, className = "" }: ShellProps) {
  return (
    <section aria-label={label} className={`max-w-[92%] animate-card-in rounded-card bg-surface p-5 shadow-float ${className}`}>
      {children}
    </section>
  );
}

type PillProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
  /** Grey is the quiet choice, accent the one that matters. Same size either way: declining is never smaller. */
  tone: "grey" | "accent";
  className?: string;
};

const tones = {
  grey: "bg-group hover:bg-bubble-muse active:bg-bubble-muse",
  accent: "bg-accent text-white transition-[filter] hover:brightness-110 active:brightness-90",
} as const;

export function Pill({ tone, className = "", type = "button", ...rest }: PillProps) {
  return (
    <button
      type={type}
      className={`rounded-full px-4 py-2.5 text-[15px] font-semibold transition-colors disabled:opacity-50 ${tones[tone]} ${className}`}
      {...rest}
    />
  );
}
