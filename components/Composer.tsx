"use client";

import { ArrowUp } from "lucide-react";
import { useState } from "react";
import type { Result } from "@/lib/ui/actions";
import { canSend, composerView, type ComposerRules } from "@/lib/ui/composer";
import { copy } from "@/lib/ui/copy";

type Props = ComposerRules & {
  /** Posts what was typed to your own Muse. A failure shows under the field; success clears it. */
  onSend: (text: string) => Promise<Result>;
};

/**
 * The "Message" bar under the thread, like the one in the Muse app: always typable, and everything sent goes to your own
 * Muse, which answers in the thread. It sits below the cards and never needs to be used: the demo runs without typing.
 * The field stays open while a message is on its way (closing it would drop the keyboard); only a second send waits.
 */
export function Composer({ onSend, ...rules }: Props) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = composerView(rules);

  async function send() {
    if (!canSend(text, pending)) return;
    setPending(true);
    setError(null);
    const result = await onSend(text.trim());
    setPending(false);
    if (result.ok) setText("");
    else setError(result.message);
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      className="shrink-0 px-3 pb-3"
    >
      <div className="flex items-center gap-2 rounded-full border border-bezel-line bg-surface py-1.5 pl-4 pr-1.5 shadow-float focus-within:border-ask-line">
        <input
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={view.placeholder}
          aria-label={view.label}
          enterKeyHint="send"
          autoComplete="off"
          // 16px keeps iOS from zooming the page when the field takes focus.
          className="min-w-0 flex-1 bg-transparent text-[16px] leading-[22px] outline-none placeholder:text-faint"
        />
        {text.trim().length > 0 || pending ? (
          <button
            type="submit"
            disabled={pending}
            aria-label={pending ? copy.composerSending : copy.composerSend}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-white transition-[filter] hover:brightness-110 active:brightness-90 disabled:opacity-60"
          >
            <ArrowUp className="size-[18px]" strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 px-4 text-[13px] leading-[18px] text-withheld">
          {error}
        </p>
      ) : null}
    </form>
  );
}
