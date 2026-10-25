import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DraftCard } from "@/components/DraftCard";
import { HoldRow } from "@/components/HoldRow";
import { copy } from "@/lib/ui/copy";
import { whatsAppUrl } from "@/lib/ui/handoff";

const CHECK = 'data-mark="check"';

const googleUrl = "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Shawarma";
const hold = { planId: "plan_1", role: "a" as const, title: "Shawarma with Michelle", googleUrl };
const attr = (value: string) => value.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

describe("the calendar row", () => {
  it("offers both ways to keep the hold before anything was tapped", () => {
    const html = renderToStaticMarkup(createElement(HoldRow, hold));
    expect(text(html)).toContain(copy.holdAction);
    expect(text(html)).toContain(copy.holdGoogle);
    expect(html).not.toContain(CHECK);
  });

  it("reads Added to your calendar with the check and a secondary Change plans after the Google link was tapped", () => {
    const html = renderToStaticMarkup(createElement(HoldRow, { ...hold, initiallyAdded: "google" }));
    expect(text(html)).toContain("Added to your calendar");
    expect(text(html)).toContain("Change plans");
    expect(html).toContain(CHECK);
    expect(text(html)).not.toContain(copy.holdGoogle);
  });

  it("keeps the second tap working: the status is the same link, so it opens the event again", () => {
    const google = renderToStaticMarkup(createElement(HoldRow, { ...hold, initiallyAdded: "google" }));
    expect(google).toContain(`href="${attr(googleUrl)}"`);
    const ics = renderToStaticMarkup(createElement(HoldRow, { ...hold, initiallyAdded: "ics" }));
    expect(ics).toContain('href="/api/plans/plan_1/hold.ics?role=a"');
    expect(ics).toContain('download="hold.ics"');
  });

  it("opens Change plans as a WhatsApp message to the friend, written by the person, never sent by the Muse", () => {
    const html = renderToStaticMarkup(createElement(HoldRow, { ...hold, initiallyAdded: "google" }));
    expect(html).toContain(`href="${attr(whatsAppUrl(copy.changePlansDraft))}"`);
    const url = new URL(whatsAppUrl(copy.changePlansDraft));
    expect(url.origin + url.pathname).toBe("https://wa.me/");
    expect(url.searchParams.get("text")).toBe("Hey, can we change our plans?");
  });

  it("shows a recording's row without any of it live", () => {
    const html = renderToStaticMarkup(createElement(HoldRow, { ...hold, disabled: true, initiallyAdded: "google" }));
    expect(text(html)).toContain(copy.holdAction);
    expect(html).not.toContain("href=");
  });
});

describe("the WhatsApp draft card", () => {
  const draft = "Michelle's in. Want to try the new shawarma place Tuesday at 6?";
  const render = (extra: object = {}) => renderToStaticMarkup(createElement(DraftCard, { draft, onHandoff: () => {}, ...extra }));

  it("offers Copy and Open WhatsApp, with the WhatsApp glyph, before the hand-off", () => {
    expect(text(render())).toContain(copy.draftOpenWhatsApp);
    expect(render()).toContain('data-glyph="whatsapp"');
    expect(text(render())).not.toContain("Continue this conversation in WhatsApp");
  });

  it("collapses to the draft and one secondary button after the hand-off: no Copy, no Open", () => {
    const html = render({ initiallyOpened: true });
    expect(text(html)).toContain(draft);
    expect(text(html)).toContain("Continue in WhatsApp");
    expect(text(html)).not.toContain(copy.draftCopy);
    expect(text(html)).not.toContain(copy.draftOpenWhatsApp);
    expect(text(html)).not.toContain("Open again");
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toContain("<button");
    expect(html).toContain("w-full");
    expect(html).toContain('data-glyph="whatsapp"');
    // The glyph carries Muse's check as a badge; the long label is read aloud, the short one is shown.
    expect(html).toContain(CHECK);
    expect(html).toContain(`aria-label="${copy.draftHandedOffLabel}"`);
    expect(copy.draftHandedOff).toBe("Continue in WhatsApp");
    expect(copy.draftHandedOffLabel).toBe("Continue this conversation in WhatsApp");
  });

  it("keeps the one button pointed at the same draft, so the second tap still opens WhatsApp", () => {
    const html = render({ initiallyOpened: true });
    expect(html).toContain(`href="${attr(whatsAppUrl(draft))}"`);
  });
});
