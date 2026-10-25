"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copy } from "@/lib/ui/copy";
import { namesFor } from "@/lib/ui/format";
import type { UiMessage, UiSnapshot } from "@/lib/ui/types";
import { ActivityPanel } from "./ActivityPanel";
import { JsonDrawer } from "./JsonDrawer";

type Props = { snapshot: UiSnapshot; onClose: () => void };

/** The Activity timeline as a bottom sheet, for the single-phone routes. */
export function ActivitySheet({ snapshot, onClose }: Props) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const [openMessage, setOpenMessage] = useState<UiMessage | null>(null);

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  return (
    <div
      className="absolute inset-0 z-30 flex items-end bg-black/10"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          if (openMessage) setOpenMessage(null);
          else onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={copy.activityTitle}
        className="relative flex h-[85%] w-full animate-card-in flex-col overflow-hidden rounded-t-card bg-surface shadow-float"
      >
        <div className="flex shrink-0 justify-end px-4 pt-3">
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label={copy.drawerClose}
            className="grid size-9 place-items-center rounded-full bg-group transition-colors hover:bg-bubble-muse"
          >
            <X className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <ActivityPanel snapshot={snapshot} connected onOpenMessage={setOpenMessage} />
        </div>
        <JsonDrawer message={openMessage} budget={snapshot.budget ?? null} names={namesFor(snapshot)} onClose={() => setOpenMessage(null)} />
      </section>
    </div>
  );
}
