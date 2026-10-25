import Link from "next/link";
import { copy } from "@/lib/ui/copy";
import { momentsOf } from "@/lib/ui/moments";
import type { UiSnapshot } from "@/lib/ui/types";
import { MomentChips } from "./MomentChips";

/**
 * The stage header: the lockup on the left with its subline, "How it works" and the three moment chips on the right.
 * The subline is one string (copy.tagline); the Meta lockup waits on Meta's approval and would replace only that.
 */
export function TopBar({ snapshot }: { snapshot: UiSnapshot | null }) {
  const [first, ...rest] = copy.brand.split(" ");
  return (
    <header className="flex h-[72px] shrink-0 items-center justify-between px-12">
      <Link href="/" className="flex flex-col gap-1 text-ink no-underline">
        <h1 className="text-[22px] font-bold leading-none tracking-[-0.02em]" aria-label={copy.brand}>
          {first} <span className="text-accent-dot">{rest.join(" ")}</span>
        </h1>
        <span className="text-[11px] font-medium leading-[14px] text-muted">{copy.tagline}</span>
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
