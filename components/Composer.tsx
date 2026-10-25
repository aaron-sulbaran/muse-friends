"use client";

import { ArrowUp } from "lucide-react";
import { useRef, useState } from "react";
import type { Result } from "@/lib/ui/actions";
import { canSend, composerView, toggleMode, type ComposerMode, type ComposerRules } from "@/lib/ui/composer";
import { copy } from "@/lib/ui/copy";
import { MuseAvatar } from "./MuseAvatar";

type Props = ComposerRules & {
  /** Posts what was typed, to the friend or to your own Muse. A failure shows under the field; success clears it. */
  onSend: (text: string, mode: ComposerMode) => Promise<Result>;
};

const copyFor = { message: copy.composerMessage, placeholder: copy.composerAskPlaceholder };

/**
 * The composer under the thread: "Message Michelle" at the left and an "Ask Sprout" pill at the right. The pill turns
 * the field into a private question to your own Muse, filled blue while it is on; tap it again to go back. It sits
 * below the cards and never needs to be used: the demo runs without typing.
 */
export function Composer({ onSend, ...rules }: Props) {
  const [mode, setMode] = useState<ComposerMode>("friend");
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const view = composerView(mode, rules, copyFor);
  const effectiveMode: ComposerMode = rules.askEnabled ? mode : "friend";

  async function send() {
    if (!canSend(text, view, pending)) return;
    setPending(true);
    setError(null);
    const result = await onSend(text.trim(), effectiveMode);
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
          ref={field}
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={!view.inputEnabled || pending}
          placeholder={view.placeholder}
          aria-label={view.placeholder}
          enterKeyHint="send"
          autoComplete="off"
          // 16px keeps iOS from zooming the page when the field takes focus.
          className="min-w-0 flex-1 bg-transparent text-[16px] leading-[22px] outline-none placeholder:text-faint disabled:cursor-default"
        />
        {canSend(text, view, pending) ? (
          <button
            type="submit"
            aria-label={pending ? copy.composerSending : copy.composerSend}
            className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-white transition-[filter] hover:brightness-110 active:brightness-90"
          >
            <ArrowUp className="size-[18px]" strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null}
        <button
          type="button"
          disabled={view.askPill === "unavailable"}
          aria-pressed={view.askPill === "on"}
          title={view.askPill === "unavailable" ? copy.composerAskUnavailable(rules.museName) : undefined}
          onClick={() => {
            const next = toggleMode(mode, rules.askEnabled);
            setMode(next);
            // The field is closed until the state lands, so focus it on the next tick: asking should put the cursor there.
            if (next === "muse") setTimeout(() => field.current?.focus(), 0);
          }}
          className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full pl-1.5 pr-3 text-[13px] font-semibold transition-colors disabled:opacity-50 ${
            view.askPill === "on" ? "bg-accent-dot text-white" : "bg-group text-ink hover:bg-bubble-muse"
          }`}
        >
          <MuseAvatar agent="aaron" name="" size={18} />
          {copy.composerAskPill(rules.museName)}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 px-4 text-[13px] leading-[18px] text-withheld">
          {error}
        </p>
      ) : null}
    </form>
  );
}
