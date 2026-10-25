"use client";

import { useEffect, useRef } from "react";
import { EMBED_MIN_FRAME_HEIGHT, EMBED_RENDER_TIMEOUT_MS, INSTAGRAM_EMBED_SCRIPT } from "@/lib/ui/reel";

declare global {
  interface Window {
    instgrm?: { Embeds: { process: () => void } };
  }
}

let scriptLoad: Promise<void> | null = null;

/** Adds Instagram's embed script once, asynchronously, so a slow or blocked script never holds up the page. */
function loadEmbedScript(): Promise<void> {
  scriptLoad ??= new Promise<void>((resolve, reject) => {
    if (window.instgrm) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.async = true;
    script.src = INSTAGRAM_EMBED_SCRIPT;
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      scriptLoad = null;
      reject(new Error("The Instagram embed script did not load"));
    };
    document.head.appendChild(script);
  });
  return scriptLoad;
}

type Props = {
  /** A canonical instagram.com reel address from instagramEmbedUrl. */
  url: string;
  /** Instagram's frame is on the page and has its content's height. */
  onRendered: () => void;
  /** No finished frame within the timeout, or the script is blocked: the caller keeps its plain card. */
  onFailed: () => void;
};

/**
 * Instagram's standard embed: the blockquote Instagram documents, with no caption (the chat already carries
 * it), turned into a frame by their script. The blockquote is built outside React because the script replaces
 * it, and React must not own a node that something else swaps out.
 */
export function InstagramEmbed({ url, onRendered, onFailed }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onRendered, onFailed });
  useEffect(() => {
    callbacks.current = { onRendered, onFailed };
  });

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const quote = document.createElement("blockquote");
    quote.className = "instagram-media";
    quote.setAttribute("data-instgrm-permalink", url);
    quote.setAttribute("data-instgrm-version", "14");
    quote.style.cssText = "width:100%;min-width:0;max-width:100%;margin:0;padding:0;border:0;background:transparent";
    element.appendChild(quote);

    let settled = false;
    const settle = (rendered: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      if (rendered) callbacks.current.onRendered();
      else callbacks.current.onFailed();
    };
    // The script drops its frame in at 2px tall and sizes it once the reel's page has loaded; only a frame
    // with a real height counts, so the plain card never gives way to a blank gap.
    const poll = setInterval(() => {
      const frame = element.querySelector("iframe");
      if (frame && frame.getBoundingClientRect().height > EMBED_MIN_FRAME_HEIGHT) settle(true);
    }, 150);
    const timer = setTimeout(() => settle(false), EMBED_RENDER_TIMEOUT_MS);

    loadEmbedScript()
      .then(() => window.instgrm?.Embeds.process())
      .catch(() => settle(false));

    return () => {
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      element.replaceChildren();
    };
  }, [url]);

  return <div ref={host} className="w-full" />;
}
