import { MessageCircle, Shield, Smartphone } from "lucide-react";
import { loopCopy } from "@/lib/how";

const { diagram } = loopCopy;

/** A Muse's portrait, bare, with the words for what it was given under it, on a soft tint for its side. */
function Side({ character, tint, label, decides, mirrored }: { character: "sprout" | "mochi"; tint: string; label: string; decides: string; mirrored?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col items-center gap-2 rounded-group px-2 py-3 text-center ${tint}`}>
      {/* A fixed render from the brand kit, not user content. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/avatars/${character}-portrait.png`} alt="" width={64} height={64} className={`size-16 object-contain ${mirrored ? "-scale-x-100" : ""}`} />
      <p className="text-[12px] leading-4 text-muted">{label}</p>
      <span className="mt-1 flex items-center gap-1.5 text-[13px] font-semibold leading-[18px]">
        <Smartphone className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        {decides}
      </span>
    </div>
  );
}

/** One arrow between a Muse and the gate, with the message type riding on it. */
function Arrow({ direction, chip }: { direction: "right" | "left"; chip: string }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="rounded-full bg-surface px-2 py-0.5 text-[11px] font-semibold leading-4">{chip}</span>
      <svg viewBox="0 0 48 10" className="w-10 sm:w-12" aria-hidden="true">
        <line x1={direction === "right" ? 2 : 46} y1="5" x2={direction === "right" ? 40 : 8} y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d={direction === "right" ? "M38 1.5 L44 5 L38 8.5" : "M10 1.5 L4 5 L10 8.5"} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

/** Figure for "The loop": two Muses, the gate between them, two people deciding, one message sent by hand. Inline SVG and text only. */
export function HowLoopDiagram() {
  const [offer, counter, yes] = diagram.chips;
  return (
    <figure className="mt-4 rounded-group bg-group p-4 sm:p-5" aria-label="Two Muses trade offers through a sharing gate, then each person decides and one person sends the message">
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 sm:gap-4">
        <Side character="sprout" tint="bg-bubble-sprout" label={diagram.you} decides={diagram.youDecide} mirrored />
        <div className="flex flex-col items-center gap-2 pt-2">
          <Arrow direction="right" chip={offer} />
          <div className="flex flex-col items-center gap-1 rounded-group bg-surface px-3 py-2 shadow-float">
            <Shield className="size-5" strokeWidth={1.75} aria-hidden="true" />
            <span className="text-[12px] font-semibold leading-4">{diagram.gate}</span>
          </div>
          <Arrow direction="left" chip={counter} />
          <span className="rounded-full bg-accent-dot px-2.5 py-0.5 text-[11px] font-semibold leading-4 text-surface">{yes}</span>
        </div>
        <Side character="mochi" tint="bg-bubble-mochi" label={diagram.friend} decides={diagram.friendDecides} />
      </div>
      <svg viewBox="0 0 320 44" className="mx-auto mt-3 block h-11 w-full max-w-[320px] text-ink" aria-hidden="true">
        <path d="M56 2 V20 Q56 26 62 26 H158 Q160 26 160 28 V42 M264 2 V20 Q264 26 258 26 H162 Q160 26 160 28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <p className="mt-1 flex items-center justify-center gap-2 text-[13px] font-semibold leading-[18px]">
        <MessageCircle className="size-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
        {diagram.send} in {diagram.channel}
      </p>
    </figure>
  );
}
