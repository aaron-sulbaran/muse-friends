"use client";

import { useState } from "react";
import { postPaymentsScope } from "@/lib/ui/actions";
import { copy } from "@/lib/ui/copy";
import { formatDollars } from "@/lib/ui/payments";
import { PAYMENT_MAX_DOLLARS } from "@/lib/protocol";
import type { PaymentsSettings, Role } from "@/lib/ui/types";

type Props = {
  role: Role;
  settings: PaymentsSettings;
  /** Called after a change lands so the caller can refresh the snapshot at once. */
  onChanged: () => void;
};

/**
 * What this seat lets its Muse do with money: off unless switched on, with the most per plan in whole dollars.
 * Same switch as the sharing toggles; the limit is enforced in code at both ends, not by the prompt.
 */
export function PaymentsSection({ role, settings, onChanged }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capText, setCapText] = useState(String(settings.cap));
  const [seenCap, setSeenCap] = useState(settings.cap);

  // The snapshot is the truth: follow it when it changes (a change elsewhere, or the server clamping a value).
  if (settings.cap !== seenCap) {
    setSeenCap(settings.cap);
    setCapText(String(settings.cap));
  }

  async function change(enabled: boolean, cap?: number) {
    setPending(true);
    setError(null);
    const result = await postPaymentsScope(role, enabled, cap);
    setPending(false);
    if (!result.ok) setError(result.message);
    onChanged();
  }

  function commitCap() {
    const value = Number(capText);
    if (!Number.isInteger(value) || value < 0 || value > PAYMENT_MAX_DOLLARS) {
      setCapText(String(settings.cap));
      setError(`Enter whole dollars from 0 to ${formatDollars(PAYMENT_MAX_DOLLARS)}`);
      return;
    }
    if (value !== settings.cap) void change(settings.enabled, value);
  }

  return (
    <section className="mt-5" aria-label={copy.paymentsSection}>
      <h3 className="text-[13px] font-semibold leading-[18px] text-muted">{copy.paymentsSection}</h3>
      <ul className="mt-1 divide-y divide-bezel-line">
        <li>
          <label className="flex items-center justify-between gap-4 py-3">
            <span>
              <span className="block text-[16px] leading-[22px]">{copy.paymentsSwitch}</span>
              <span className="block text-[12px] leading-4 text-muted">
                {settings.enabled ? copy.paymentsSwitchHint(formatDollars(settings.cap)) : copy.paymentsOffDetail}
              </span>
            </span>
            <input
              type="checkbox"
              role="switch"
              checked={settings.enabled}
              disabled={pending}
              onChange={(event) => change(event.target.checked)}
              className="peer sr-only"
            />
            <span
              aria-hidden="true"
              className="relative h-7 w-12 shrink-0 cursor-pointer rounded-full bg-faint transition-colors after:absolute after:left-0.5 after:top-0.5 after:size-6 after:rounded-full after:bg-surface after:shadow-float after:transition-transform peer-checked:bg-tracking peer-checked:after:translate-x-5 peer-disabled:cursor-default peer-disabled:opacity-60 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
            />
          </label>
        </li>
        {settings.enabled ? (
          <li>
            <label className="flex items-center justify-between gap-4 py-3">
              <span>
                <span className="block text-[16px] leading-[22px]">{copy.paymentsCap}</span>
                {settings.cap === 0 ? <span className="block text-[12px] leading-4 text-muted">{copy.paymentsCapOff}</span> : null}
              </span>
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-group px-3 py-1.5 text-[16px] leading-[22px]">
                <span aria-hidden="true">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={capText}
                  disabled={pending}
                  onChange={(event) => setCapText(event.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
                  onBlur={commitCap}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  aria-label={copy.paymentsCap}
                  className="w-12 bg-transparent text-right font-semibold tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60"
                />
              </span>
            </label>
          </li>
        ) : null}
      </ul>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] leading-[18px] text-withheld">
          {error}
        </p>
      ) : null}
    </section>
  );
}
