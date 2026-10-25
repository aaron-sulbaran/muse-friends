"use client";

import { useState } from "react";
import { MAX_TOOL_LINES, toolLines, type ToolLineContext, type UiToolCall } from "@/lib/ui/tools";

type Props = {
  calls: UiToolCall[] | undefined;
  /** The scheduling decision and why (`whyLine`), shown last; it counts as one of the lines. */
  why?: string;
  context: ToolLineContext;
  /** Show every line from the start, for a card drawn after the fact. */
  initiallyOpen?: boolean;
};

/**
 * Under an Activity row: every tool the agent used, one compact line each in plain words, 12px muted and always
 * visible, then the why. A web search carries its pages as host chips that open in a new tab. Six lines at most;
 * the tool lines past that sit behind "+n more", and the why stays in view.
 */
export function ToolLines({ calls, why, context, initiallyOpen = false }: Props) {
  const [open, setOpen] = useState(initiallyOpen);
  const items = toolLines(calls, context);
  if (items.length === 0 && !why) return null;

  const room = why ? MAX_TOOL_LINES - 1 : MAX_TOOL_LINES;
  const shown = open ? items : items.slice(0, room);
  const hidden = items.length - shown.length;

  return (
    <ul className="flex flex-col gap-0.5 pb-2.5 pl-[60px] pr-3 text-[12px] leading-4 text-muted">
      {shown.map((item, index) => (
        <li key={index} data-line>
          {item.text}
          {item.sources.length > 0 ? (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {item.sources.map((source) => (
                <a
                  key={source.host}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-full bg-group px-2.5 py-1 text-[12px] leading-4 text-ink transition-colors [@media(hover:hover)]:hover:bg-bubble-muse"
                >
                  {source.host}
                </a>
              ))}
            </span>
          ) : null}
        </li>
      ))}
      {hidden > 0 ? (
        <li>
          <button type="button" onClick={() => setOpen(true)} className="font-medium underline underline-offset-2 [@media(hover:hover)]:hover:text-ink">
            +{hidden} more
          </button>
        </li>
      ) : null}
      {why ? <li data-line>{why}</li> : null}
    </ul>
  );
}
