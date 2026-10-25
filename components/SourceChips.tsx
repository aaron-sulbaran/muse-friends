import { ExternalLink } from "lucide-react";
import type { UiSource } from "@/lib/ui/types";

/**
 * Where a searched answer came from: one small "Source" pill per page the web search found (three at most), each with
 * the site's host and a link that opens the real page in a new tab. The pages are somebody else's, so the link carries
 * no opener and no referrer, and the pill says the host, not what the page claims about itself.
 */
export function SourceChips({ sources }: { sources: UiSource[] }) {
  if (sources.length === 0) return null;
  return (
    <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Sources">
      {sources.slice(0, 3).map((source) => (
        <li key={source.url}>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={source.title}
            aria-label={`Source: ${source.host}, ${source.title} (opens in a new tab)`}
            className="inline-flex max-w-[160px] items-center gap-1 rounded-full border border-aside-line bg-group px-2 py-px text-[12px] leading-4 text-muted"
          >
            <span className="font-semibold">Source</span>
            <span className="truncate">{source.host}</span>
            <ExternalLink className="size-[10px] shrink-0" strokeWidth={2} aria-hidden="true" />
          </a>
        </li>
      ))}
    </ul>
  );
}
