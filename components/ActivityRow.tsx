import {
  formatLatency,
  formatTimeWithSeconds,
  messageAccessibleName,
  messageTitle,
  policyStampFor,
  type Names,
} from "@/lib/ui/format";
import type { MemberId, UiMessage } from "@/lib/ui/types";
import { MuseAvatar } from "./MuseAvatar";
import { PolicyStamp } from "./PolicyStamp";

type Props = {
  message: UiMessage;
  initials: Record<MemberId, string | null>;
  names: Names;
  onOpen: (message: UiMessage) => void;
};

/** One line per agent message: who talked to whom, what it did, what privacy allowed, and the proof it was a real model call. */
export function ActivityRow({ message, initials, names, onOpen }: Props) {
  const from = names.muse[message.from];
  const to = names.muse[message.to];
  const blocked = message.blockedRule !== undefined;
  const stamp = policyStampFor(message);

  return (
    <li className="animate-row-in">
      <button
        type="button"
        onClick={() => onOpen(message)}
        aria-label={messageAccessibleName(message, names)}
        className="flex w-full items-start gap-3 rounded-group px-3 py-2.5 text-left transition-colors hover:bg-group"
      >
        <MuseAvatar agent={message.from} initial={initials[message.from]} name={from} size={36} />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-[15px] font-semibold leading-5">
              {from} to {to}
            </span>
            <span className="shrink-0 text-[12px] leading-4 text-muted">
              {message.type} <span className="ml-1.5">{formatTimeWithSeconds(message.at)}</span>
            </span>
          </span>
          {blocked ? (
            <>
              <span className="mt-0.5 block text-[15px] leading-5 text-withheld">Blocked at {to}&apos;s inbox</span>
              <span className="block text-[13px] leading-[18px] text-muted">{message.blockedRule}</span>
            </>
          ) : (
            <>
              <span className="mt-0.5 block text-[15px] leading-5">{messageTitle(message)}</span>
              {message.note ? <span className="block text-[13px] leading-[18px] text-muted">&ldquo;{message.note}&rdquo;</span> : null}
            </>
          )}
          <PolicyStamp stamp={stamp} animateWithheld />
          {message.proof ? (
            <span className="mt-1.5 block text-[12px] leading-4 text-faint">
              {message.proof.fallbackFrom ? `answered by ${message.proof.model} (${message.proof.fallbackFrom} was not found)` : message.proof.model}, {formatLatency(message.proof.latencyMs)}, {message.proof.inputTokens + message.proof.outputTokens} tokens
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}
