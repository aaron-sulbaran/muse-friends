import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DemoControls } from "@/components/DemoControls";
import { controlInfo, jumpLabel, loadReelLabel, SCENARIO_LOCKED_NOTE, scenarios } from "@/lib/ui/controls";
import type { UiReel } from "@/lib/ui/types";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const replay = { active: false, start: async () => {}, stop: () => {}, error: null };
const open = () => renderToStaticMarkup(createElement(DemoControls, { snapshot: null, onChanged: () => {}, replay, onPaused: () => {}, initiallyOpen: true }));

describe("what each control says it does", () => {
  it("is one plain sentence per control, with no dash and no emoji", () => {
    expect(Object.keys(controlInfo).sort()).toEqual(["invite", "jump", "leak", "loadReel", "replay", "reset", "scenario"]);
    for (const sentence of Object.values(controlInfo)) {
      expect(sentence.endsWith(".")).toBe(true);
      expect(sentence.slice(0, -1)).not.toContain(".");
      expect(sentence).not.toMatch(/\u2014|\u2013/);
      expect(sentence).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("matches what the control really does", () => {
    expect(controlInfo.reset).toContain("whole demo room");
    expect(controlInfo.loadReel).toContain("one-to-one scenario");
    expect(controlInfo.jump).toContain("demo clock");
    expect(controlInfo.replay).toContain("labeled recording");
    expect(controlInfo.leak).toContain("two forged messages");
    expect(controlInfo.leak).toContain("refusals");
  });
});

describe("the labels that follow the data", () => {
  it("names the reel once a live one has landed", () => {
    const live: UiReel = { username: "the.foodie.patootie", caption: "x", permalink: "https://example.com", thumbnailUrl: null };
    expect(loadReelLabel(null)).toBe("Load the shawarma reel");
    expect(loadReelLabel(live)).toBe("Load @the.foodie.patootie's reel");
  });

  it("moves from reminder to next day", () => {
    expect(jumpLabel("confirmed")).toBe("Jump to reminder");
    expect(jumpLabel("reminded")).toBe("Jump to next day");
    expect(jumpLabel(undefined)).toBe("Jump to reminder");
  });
});

describe("the scenarios", () => {
  it("offers one to one and the two group scenarios, and holds new in town until its route exists on main", () => {
    expect(scenarios.map((scenario) => [scenario.label, scenario.available])).toEqual([
      ["One to one", true],
      ["New in town", false],
      ["Group of three", true],
      ["Group trip", true],
    ]);
    expect(SCENARIO_LOCKED_NOTE).toBe("after the gate");
  });
});

describe("the panel", () => {
  it("lists the controls, each with its sentence", () => {
    const html = text(open());
    for (const label of ["Load the shawarma reel", "Jump to reminder", "Replay a recorded run", "Replay the recorded trip", "Try to leak", "Reset"]) expect(html).toContain(label);
    for (const key of ["reset", "loadReel", "jump", "replay", "replayTrip", "leak"] as const) expect(html).toContain(controlInfo[key]);
  });

  it("has a Scenario row with new in town disabled and marked after the gate", () => {
    const html = open();
    expect(text(html)).toContain("Scenario");
    expect(html.match(/role="radio"[^>]*aria-checked="true"[^>]*>[^<]*(<[^>]+>)*[^<]*One to one/)).not.toBeNull();
    expect(html.match(/>after the gate</g)).toHaveLength(1);
    expect(html.match(/role="radio"[^>]*disabled=""/g)).toHaveLength(1);
  });

  it("has an Invite a friend row that shows a link to copy", () => {
    const html = text(open());
    expect(html).toContain("Invite a friend");
    expect(html).toContain("Copy link");
    expect(html).toContain(controlInfo.invite);
  });
});
