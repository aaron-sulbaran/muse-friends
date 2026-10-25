import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Composer } from "@/components/Composer";
import { MuseScreen } from "@/components/MuseScreen";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { canSend, composerView, type ComposerRules } from "@/lib/ui/composer";
import { copy } from "@/lib/ui/copy";
import { toUiSnapshot } from "@/lib/ui/snapshot";

const rules = (change: Partial<ComposerRules> = {}): ComposerRules => ({ museName: "Sprout", ...change });
const noop = async () => ({ ok: true }) as const;

describe("what the Message bar shows", () => {
  it("says Message, and names the Muse only for a screen reader", () => {
    expect(composerView(rules())).toEqual({ placeholder: "Message", label: "Message Sprout" });
    expect(composerView(rules({ museName: "Mochi" })).label).toBe("Message Mochi");
  });
});

describe("when a message can be sent", () => {
  it("needs words and nothing already on its way; the field itself is never closed", () => {
    expect(canSend("Why Tuesday?", false)).toBe(true);
    expect(canSend("   ", false)).toBe(false);
    expect(canSend("", false)).toBe(false);
    expect(canSend("Why Tuesday?", true)).toBe(false);
  });
});

describe("the bar", () => {
  const html = (change: Partial<ComposerRules> = {}) => renderToStaticMarkup(createElement(Composer, { ...rules(change), onSend: noop }));

  it("is one always-typable field: placeholder Message, labelled with the Muse, never disabled", () => {
    const markup = html();
    expect(markup).toContain('placeholder="Message"');
    expect(markup).toContain('aria-label="Message Sprout"');
    expect(markup).not.toMatch(/<input[^>]*disabled/);
  });

  it("has no Ask pill, no friend mode and no old copy", () => {
    const markup = html();
    expect(markup).not.toContain("Ask Sprout");
    expect(markup).not.toContain("aria-pressed");
    expect(markup).not.toContain("Message Michelle");
    expect(markup).not.toContain("privately");
    expect(markup).not.toContain("<img");
    expect(Object.keys(copy).filter((key) => /^composerAsk|^composerMessage$/.test(key))).toEqual([]);
  });

  it("keeps the field at 16px so iOS does not zoom", () => {
    expect(html()).toMatch(/<input[^>]*class="[^"]*text-\[16px\]/);
  });

  it("offers no send button until there is something to send", () => {
    expect(html()).not.toContain(`aria-label="${copy.composerSend}"`);
  });

  it("has no emoji and no em dash", () => {
    expect(html()).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(html()).not.toMatch(/—|–/);
  });
});

describe("where the bar sits", () => {
  const snapshot = toUiSnapshot(snapshotAtPlanState("awaiting_humans"), { mode: "live" });
  const screen = (props: Record<string, unknown>) => renderToStaticMarkup(createElement(MuseScreen, { snapshot, onChanged: () => undefined, ...props } as never));

  it("is on the judge's phone and on the stage's phone, which has no standalone page around it", () => {
    expect(screen({ role: "a", standalone: { activity: () => null } })).toContain('aria-label="Message Sprout"');
    expect(screen({ role: "a", framed: true })).toContain('aria-label="Message Sprout"');
  });

  it("is not on the friend's phone or on a recording", () => {
    expect(screen({ role: "b", framed: true })).not.toContain('placeholder="Message"');
    expect(screen({ role: "a", framed: true, readOnly: true })).not.toContain('placeholder="Message"');
  });
});
