import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { copy } from "@/lib/ui/copy";
import { sideHref, simulatedFriendHref } from "@/lib/ui/entry";
import type { Role } from "@/lib/ui/types";
import { MuseAvatar } from "./MuseAvatar";

/**
 * The front door on a phone. A judge scanned a QR and holds one device, so the stage (three screens side
 * by side) is the wrong page: this is one screen with one tap to a side, or to a game with a simulated friend.
 */
export function PhoneChooser({ sides }: { sides: Record<Role, string> }) {
  return (
    <main className="flex min-h-dvh flex-col bg-linear-to-b from-surface to-stage-end px-5 pb-[max(24px,env(safe-area-inset-bottom))] pt-[max(24px,env(safe-area-inset-top))]">
      <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col">
        <h1>
          {/* A fixed vector asset from the brand kit; next/image would add nothing here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/wordmark/muse-friends-wordmark.svg" alt={copy.brand} className="h-[30px] w-auto" />
        </h1>
        <p className="mt-1 text-[13px] leading-[18px] text-muted">{copy.tagline}</p>

        <div className="flex flex-1 flex-col justify-center gap-3 py-8">
          <h2 className="mb-1 text-[26px] font-semibold leading-8">{copy.chooserTitle}</h2>
          <SideLink href={sideHref("a")} agent="aaron" name={sides.a} detail={copy.chooserReceives} />
          <SideLink href={sideHref("b")} agent="lisa" name={sides.b} detail={copy.chooserSends} />
          <Link
            href={simulatedFriendHref}
            className="mt-3 flex min-h-[72px] items-center gap-4 rounded-card bg-accent p-4 text-white shadow-float transition-[filter] hover:brightness-110 active:brightness-90"
          >
            <MuseAvatar agent="lisa" simulated name="Michelle" size={44} />
            <span className="min-w-0 flex-1">
              <span className="block text-[17px] font-semibold leading-[22px]">{copy.simulatedAction}</span>
              <span className="block text-[13px] leading-[18px] text-white/85">{copy.chooserAloneDetail}</span>
            </span>
            <ChevronRight className="size-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </main>
  );
}

function SideLink({ href, agent, name, detail }: { href: string; agent: "aaron" | "lisa"; name: string; detail: string }) {
  return (
    <Link
      href={href}
      className="flex min-h-[72px] items-center gap-4 rounded-card bg-surface p-4 shadow-float transition-colors hover:bg-group active:bg-group"
    >
      <MuseAvatar agent={agent} name={name} size={44} />
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-semibold leading-[22px]">{copy.chooserSide(name)}</span>
        <span className="block text-[13px] leading-[18px] text-muted">{detail}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-muted" strokeWidth={1.75} aria-hidden="true" />
    </Link>
  );
}
