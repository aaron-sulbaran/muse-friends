type Props = {
  name: string;
  /** Emoji first, then a lowercase present participle: "💬 talking to Mochi". Null when the Muse is idle. */
  status: string | null;
};

/** The avatar's name pill. It grows a second line while the Muse is working on something. */
export function StatusPill({ name, status }: Props) {
  const [emoji, ...rest] = status ? status.split(" ") : [];
  return (
    <div className="rounded-tile bg-surface px-3 py-1 text-center shadow-float transition-[padding] duration-200">
      <p className="text-[15px] font-semibold leading-5">{name}</p>
      {status ? (
        <p key={status} className="animate-fade-in text-[13px] leading-[18px] text-muted" aria-live="polite">
          <span aria-hidden="true">{emoji} </span>
          {rest.join(" ")}
        </p>
      ) : null}
    </div>
  );
}
