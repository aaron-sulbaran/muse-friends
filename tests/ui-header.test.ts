import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MomentChips } from "@/components/MomentChips";
import { TopBar } from "@/components/TopBar";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { copy } from "@/lib/ui/copy";
import { momentsOf } from "@/lib/ui/moments";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import type { PlanState } from "@/lib/ui/types";

const at = (state: PlanState) => toUiSnapshot(snapshotAtPlanState(state), { mode: "live" });
const reached = (state: PlanState) => momentsOf(at(state)).map((moment) => moment.reachedAt !== null);
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

describe("the three moments", () => {
  it("are Said yes, Message sent and They went, in that order", () => {
    expect(momentsOf(null).map((moment) => moment.label)).toEqual(["Said yes", "Message sent", "They went"]);
  });

  it("light up one by one as the plan moves", () => {
    expect(momentsOf(null).map((moment) => moment.reachedAt)).toEqual([null, null, null]);
    expect(reached("awaiting_humans")).toEqual([false, false, false]);
    expect(reached("confirmed")).toEqual([true, false, false]);
    expect(reached("scheduled")).toEqual([true, true, false]);
    expect(reached("reminded")).toEqual([true, true, false]);
    expect(reached("followed_up")).toEqual([true, true, true]);
  });

  it("carry the time each one happened, from the plan's own history", () => {
    const snapshot = at("scheduled");
    const [saidYes, sent] = momentsOf(snapshot);
    expect(saidYes.reachedAt).toBe(snapshot.plan?.history.find((entry) => entry.state === "confirmed")?.at);
    expect(sent.reachedAt).toBe(snapshot.plan?.history.find((entry) => entry.state === "scheduled")?.at);
  });

  it("count a dropped plan as nothing reached", () => {
    expect(reached("dropped")).toEqual([false, false, false]);
  });

  it("say what each means, in the CDO's words", () => {
    expect(momentsOf(null).map((moment) => moment.line)).toEqual([
      "Both people tapped Set it up on the plan.",
      "The plan went out to both people's chats.",
      "Both people tapped We went after the plan. This is the number we measure: plans that happened, not messages sent.",
    ]);
  });
});

describe("the stage header", () => {
  const html = renderToStaticMarkup(createElement(TopBar, { snapshot: at("scheduled") }));

  it("is the text lockup with a one-string subline and no Meta mark", () => {
    expect(text(html)).toContain("Muse Friends");
    expect(copy.tagline).toBe("a proposal for Muse");
    expect(text(html)).toContain(copy.tagline);
    expect(html).not.toMatch(/meta/i);
    expect(html).not.toContain("<svg");
  });

  it("links How it works to /how, top right", () => {
    expect(html).toMatch(/<a [^>]*href="\/how"[^>]*>How it works<\/a>/);
  });

  it("shows the three chips and no Follow-through counter", () => {
    for (const label of ["Said yes", "Message sent", "They went"]) expect(text(html)).toContain(label);
    expect(text(html)).not.toContain("Follow-through");
  });

  it("marks what was reached for assistive tech, not by colour alone", () => {
    expect(html).toContain('aria-label="Said yes, reached"');
    expect(html).toContain('aria-label="Message sent, reached"');
    expect(html).toContain('aria-label="They went, not yet"');
  });
});

describe("a chip's info card", () => {
  const closed = () => renderToStaticMarkup(createElement(MomentChips, { moments: momentsOf(null) }));
  const card = (key: "said-yes" | "message-sent" | "they-went", onShow?: () => void) =>
    renderToStaticMarkup(createElement(MomentChips, { moments: momentsOf(at("followed_up")), initiallyOpen: key, onShow }));

  it("shows the name, the line and the time it happened", () => {
    const html = text(card("they-went"));
    expect(html).toContain("They went");
    expect(html).toContain("This is the number we measure: plans that happened, not messages sent.");
    expect(html).toMatch(/\d{1,2}:\d{2} (AM|PM)/);
  });

  it("says not yet for a moment that has not happened", () => {
    const html = renderToStaticMarkup(createElement(MomentChips, { moments: momentsOf(at("awaiting_humans")), initiallyOpen: "said-yes" }));
    expect(text(html)).toContain("Not yet");
  });

  it("offers Show in conversation only when something can scroll to it", () => {
    expect(text(card("said-yes"))).not.toContain("Show in conversation");
    expect(text(card("said-yes", () => {}))).toContain("Show in conversation");
    expect(closed()).not.toContain('role="dialog"');
  });
});
