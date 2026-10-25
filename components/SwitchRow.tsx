type Props = {
  label: string;
  /** One 12px line under the label saying what the switch lets through. */
  line: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (on: boolean) => void;
};

/** One labelled sharing switch, as a list row. Locked rows (Free times) are the same row, switched on and unreachable. */
export function SwitchRow({ label, line, checked, disabled = false, onChange }: Props) {
  return (
    <li>
      <label className="flex items-center justify-between gap-4 py-3">
        <span>
          <span className="block text-[16px] leading-[22px]">{label}</span>
          <span className="block text-[12px] leading-4 text-muted">{line}</span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className="relative h-7 w-12 shrink-0 cursor-pointer rounded-full bg-faint transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-6 after:rounded-full after:bg-surface after:shadow-float after:transition-transform peer-checked:bg-tracking peer-checked:after:translate-x-5 peer-disabled:cursor-default peer-disabled:opacity-60 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
        />
      </label>
    </li>
  );
}
