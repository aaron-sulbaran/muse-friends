"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { THREAD_CAP } from "@/lib/protocol";
import { copy } from "@/lib/ui/copy";
import { formatLatency, formatTimeWithSeconds, type Names } from "@/lib/ui/format";
import type { UiMessage, UiSnapshot, UiToolCall } from "@/lib/ui/types";

type Props = {
  message: UiMessage | null;
  /** The live-run caps, shown beside the message so a judge can see the credits are bounded. */
  budget: UiSnapshot["budget"];
  names: Names;
  onClose: () => void;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="text-[13px] font-semibold leading-[18px]">{title}</h3>
      <div className="mt-2 rounded-group bg-group p-3 font-mono text-[12px] leading-[18px]">{children}</div>
    </section>
  );
}

/** The tools the model call used, in order: what each was called with and what it returned, one line apiece. */
function ToolsCalled({ calls }: { calls: UiToolCall[] }) {
  return (
    <div className="mt-3 border-t border-bezel-line pt-2.5 font-sans">
      <h4 className="text-[12px] font-semibold leading-4 text-muted">{copy.drawerToolsCalled}</h4>
      <ol className="mt-1.5 flex flex-col gap-2">
        {calls.map((call, index) => (
          <li key={`${call.name}-${index}`} className="text-[12px] leading-[17px]">
            <p className="break-words font-mono">
              <span className="font-semibold">{call.name}</span>
              {call.args ? <span className="text-muted"> {call.args}</span> : null}
            </p>
            {call.result ? (
              <p className="break-words text-muted">
                {copy.drawerToolReturned} <span className="font-mono text-ink">{call.result}</span>
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Raw protocol JSON for Q&A. Collapsed by default; the consumer view never shows it. */
export function JsonDrawer({ message, budget, names, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (message && !element.open) element.showModal();
    if (!message && element.open) element.close();
  }, [message]);

  async function copyJson() {
    if (!message) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(message.raw, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      aria-label="Message details"
      className="ml-auto mr-0 h-dvh max-h-dvh w-full max-w-none min-[900px]:w-[520px] animate-drawer-in overflow-y-auto rounded-l-card bg-surface p-6 text-ink backdrop:bg-black/10"
    >
      {message ? (
        <>
          <header className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[17px] font-semibold leading-[22px]">
                Message {message.seq} of {THREAD_CAP}
              </h2>
              <p className="text-[13px] leading-[18px] text-muted">
                {names.muse[message.from]} to {names.muse[message.to]}, {formatTimeWithSeconds(message.at)}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={copy.drawerClose}
              className="grid size-9 place-items-center rounded-full bg-group transition-colors hover:bg-bubble-muse"
            >
              <X className="size-[18px]" strokeWidth={1.75} aria-hidden="true" />
            </button>
          </header>
          <Section title={copy.drawerSent}>
            <pre className="whitespace-pre-wrap break-words">{JSON.stringify(message.raw, null, 2)}</pre>
          </Section>
          <Section title={copy.drawerRemoved}>
            {message.removed.length > 0 ? (
              <pre className="whitespace-pre-wrap">{JSON.stringify({ messageId: message.id, removed: message.removed }, null, 2)}</pre>
            ) : (
              <span className="font-sans text-[13px] text-muted">{copy.drawerRemovedNone}</span>
            )}
          </Section>
          <Section title={copy.drawerModelCall}>
            {message.proof ? (
              <>
                <pre className="whitespace-pre-wrap">
                  {JSON.stringify(
                    {
                      model: message.proof.model,
                      responseId: message.proof.responseId,
                      latency: formatLatency(message.proof.latencyMs),
                      inputTokens: message.proof.inputTokens,
                      outputTokens: message.proof.outputTokens,
                      reasoningTokens: message.proof.reasoningTokens,
                    },
                    null,
                    2,
                  )}
                </pre>
                {message.proof.toolCalls && message.proof.toolCalls.length > 0 ? <ToolsCalled calls={message.proof.toolCalls} /> : null}
              </>
            ) : (
              <span className="font-sans text-[13px] text-muted">{copy.drawerNoModelCall}</span>
            )}
          </Section>
          {budget ? (
            <Section title={copy.drawerBudget}>
              <pre className="whitespace-pre-wrap">{JSON.stringify(budget, null, 2)}</pre>
            </Section>
          ) : null}
          <footer className="mt-6">
            <button
              type="button"
              onClick={copyJson}
              className="rounded-full bg-group px-4 py-2.5 text-[15px] font-semibold transition-colors hover:bg-bubble-muse"
            >
              {copied ? copy.draftCopied : copy.drawerCopy}
            </button>
          </footer>
        </>
      ) : null}
    </dialog>
  );
}
