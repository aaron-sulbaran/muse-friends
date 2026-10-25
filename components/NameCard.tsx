import { onboardingCopy } from "@/lib/ui/copy";

type Props = {
  name: string;
  onName: (name: string) => void;
};

/** The one question onboarding asks: what friends should call the judge. Empty is fine; Sprout then says "you". */
export function NameCard({ name, onName }: Props) {
  return (
    <div>
      <h3 className="text-[17px] font-semibold leading-[22px]">{onboardingCopy.nameTitle}</h3>
      <input
        type="text"
        value={name}
        onChange={(event) => onName(event.target.value)}
        aria-label={onboardingCopy.nameLabel}
        placeholder={onboardingCopy.namePlaceholder}
        autoComplete="given-name"
        enterKeyHint="done"
        maxLength={24}
        // 16px keeps iOS from zooming the page when the field takes focus.
        className="mt-3 w-full rounded-[14px] bg-group px-4 py-3 text-[16px] leading-[22px] placeholder:text-faint"
      />
    </div>
  );
}
