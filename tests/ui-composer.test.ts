import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Composer } from "@/components/Composer";
import { canSend, composerView, toggleMode, type ComposerRules } from "@/lib/ui/composer";
import { copy } from "@/lib/ui/copy";

const copyFor = { message: copy.composerMessage, placeholder: copy.composerAskPlaceholder };
const rules = (change: Partial<ComposerRules> = {}): ComposerRules => ({ friendLabel: "Michelle", museName: "Sprout", askEnabled: true, friendEnabled: false, ...change });
const noop = async () => ({ ok: true }) as const;
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

describe("what the composer shows", () => {
  it("starts as a message to the friend, with the Ask pill off", () => {
    expect(composerView("friend", rules({ friendEnabled: true }), copyFor)).toEqual({ placeholder: "Message Michelle", inputEnabled: true, askPill: "off" });
    expect(composerView("friend", rules({ friendLabel: "the group", friendEnabled: true }), copyFor).placeholder).toBe("Message the group");
  });

  it("turns into a private question to your Muse when the pill is on, with the pill filled", () => {
    expect(composerView("muse", rules(), copyFor)).toEqual({ placeholder: "Ask Sprout privately", inputEnabled: true, askPill: "on" });
  });

  it("leaves the field closed for the friend while nothing sends to her, so the pill is the way in", () => {
    expect(composerView("friend", rules({ friendEnabled: false }), copyFor).inputEnabled).toBe(false);
  });

  it("keeps Ask unavailable, and the field on the friend, until the chat turn is there", () => {
    const view = composerView("muse", rules({ askEnabled: false }), copyFor);
    expect(view).toEqual({ placeholder: "Message Michelle", inputEnabled: false, askPill: "unavailable" });
    expect(toggleMode("friend", false)).toBe("friend");
    expect(toggleMode("muse", false)).toBe("friend");
  });

  it("toggles on a tap and back on the next", () => {
    expect(toggleMode("friend", true)).toBe("muse");
    expect(toggleMode("muse", true)).toBe("friend");
  });
});

describe("when a message can be sent", () => {
  const open = composerView("muse", rules(), copyFor);
  it("needs words, an open field and nothing already on its way", () => {
    expect(canSend("Why Tuesday?", open, false)).toBe(true);
    expect(canSend("   ", open, false)).toBe(false);
    expect(canSend("Why Tuesday?", open, true)).toBe(false);
    expect(canSend("Why Tuesday?", composerView("friend", rules(), copyFor), false)).toBe(false);
  });
});

describe("the composer", () => {
  const html = (change: Partial<ComposerRules> = {}) => renderToStaticMarkup(createElement(Composer, { ...rules(change), onSend: noop }));

  it("shows the friend's placeholder at the left and the Ask Sprout pill with Sprout's portrait at the right", () => {
    const markup = html({ friendEnabled: true });
    expect(markup).toContain('placeholder="Message Michelle"');
    expect(markup).toContain("Ask Sprout");
    expect(markup).toContain('src="/avatars/sprout-portrait.png"');
    expect(markup).toContain('aria-pressed="false"');
  });

  it("keeps the field at 16px so iOS does not zoom", () => {
    expect(html()).toMatch(/<input[^>]*class="[^"]*text-\[16px\]/);
  });

  it("disables the pill, and says why on hover, while Ask is unavailable", () => {
    const markup = html({ askEnabled: false });
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>/);
    expect(markup).toContain(escaped("Asking Sprout is not available yet"));
  });

  it("offers no send button until there is something to send", () => {
    expect(html({ friendEnabled: true })).not.toContain(`aria-label="${copy.composerSend}"`);
  });

  it("has no emoji and no em dash", () => {
    expect(html()).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(html()).not.toMatch(/—|–/);
  });
});
