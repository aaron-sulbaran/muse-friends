import Link from "next/link";
import { copy } from "@/lib/ui/copy";
import { momentsOf } from "@/lib/ui/moments";
import type { UiSnapshot } from "@/lib/ui/types";
import { MomentChips } from "./MomentChips";
import { Subline } from "./Subline";

/**
 * The stage header: the lockup (the blue script Muse and Friends) on the left with its subline, "How it works" and the three
 * moment chips on the right.
 * The subline is "a proposal for Muse by" and the Meta lockup (D33), with the plain text as its fallback; see Subline.
 */
export function TopBar({ snapshot }: { snapshot: UiSnapshot | null }) {
  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between px-12">
      <Link href="/" className="flex flex-col gap-1 text-ink no-underline">
        <h1 aria-label={copy.brand} className="inline-flex items-baseline whitespace-nowrap text-[22px] font-semibold leading-none tracking-[-0.01em]">
          {/* Meta's script "Muse" in its own blue gradient, traced brand art (kb/design/wordmark/final), then "Friends" in sans. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/muse-script-blue.svg" alt="" height={26} width={68} className="mb-[-2.6px] mr-[4.5px] h-[26px] w-auto" />
          Friends
        </h1>
        <Subline />
      </Link>
      <nav className="flex items-center gap-[18px]" aria-label="Stage">
        <Link href="/how" className="text-[13px] font-semibold text-accent-dot hover:underline">
          {copy.howItWorks}
        </Link>
        <MomentChips moments={momentsOf(snapshot)} />
      </nav>
    </header>
  );
}
