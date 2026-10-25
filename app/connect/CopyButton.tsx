"use client";

import { useState } from "react";

// Copies one string. Falls back to a hidden textarea where the async clipboard is not allowed.
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-white active:opacity-80"
      aria-live="polite"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
