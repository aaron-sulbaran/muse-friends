import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HowPage } from "@/components/HowPage";
import { JsonDrawer } from "@/components/JsonDrawer";
import { TopBar } from "@/components/TopBar";
import liveRun from "@/lib/seed/live-run.json";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { HOW_ANCHORS, HOW_PATH, builtCopy, howCopy, loopCopy, museCopy, privacyCopy, protocolCopy, realCopy } from "@/lib/how";
import { NEGOTIATION_TYPES, THREAD_CAP } from "@/lib/protocol";
import { namesFor } from "@/lib/ui/format";
import { toUiSnapshot } from "@/lib/ui/snapshot";

const html = renderToStaticMarkup(createElement(HowPage));
const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const read = (path: string) => readFileSync(path, "utf8");

describe("the page", () => {
  it("has the six sections, each with an anchor the drawer and the README can link to", () => {
    for (const heading of [loopCopy.heading, realCopy.heading, privacyCopy.heading, protocolCopy.heading, museCopy.heading, builtCopy.heading]) {
      expect(text).toContain(heading);
    }
    for (const anchor of Object.values(HOW_ANCHORS)) expect(html).toContain(`id="${anchor}"`);
  });

  it("frames itself as a proposal, and says what is not Meta's", () => {
    expect(text).toContain(howCopy.subtitle);
    expect(text).toContain("It is not a Meta product.");
    expect(text).toContain("we did not build or change it");
  });

  it("goes back to the demo and on to it, and nothing else on the page leaves the site except the repo", () => {
    expect(html).toContain(`href="/"`);
    const external = [...html.matchAll(/href="(https?:[^"]+)"/g)].map((match) => match[1]);
    expect(external).toEqual(["https://github.com/aaron-sulbaran/muse-friends#readme"]);
  });

  it("keeps the writing rules: no em dash, no emoji, no all-caps label, no claim of shipping or Meta's approval", () => {
    expect(text).not.toContain("—");
    expect(text).not.toContain("·");
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(text).not.toMatch(/\bshipped\b|\bendorsed\b|approved by Meta|Meta-reviewed/i);
    expect(html).not.toMatch(/\buppercase\b/);
  });

  it("does not show a Muse screenshot: every image is our own asset", () => {
    const sources = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((match) => match[1]);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) expect(source).toMatch(/^\/(avatars|wordmark|how)\//);
  });

  it("ships every crop it points at", () => {
    for (const pattern of museCopy.patterns) if (pattern.image) expect(existsSync(`public${pattern.image}`)).toBe(true);
  });
});

describe("what it says is true of the code", () => {
  it("lists the five negotiating types the protocol has, in the protocol's order, and the real cap", () => {
    expect([...protocolCopy.chips]).toEqual([...NEGOTIATION_TYPES]);
    expect(protocolCopy.cap).toBe(`At most ${THREAD_CAP} messages a thread`);
    expect(THREAD_CAP).toBe(6);
  });

  it("pastes the privacy panels from the recorded run, not from a draft", () => {
    const beat = liveRun.privacyBeat;
    const [rule, sent, removed] = privacyCopy.panels;
    expect(rule.json).toEqual(beat.policyAfter);
    expect(rule.json.categories.location).toBe(false);
    expect(sent.json.type).toBe(beat.after.message.type);
    expect(sent.json.windows).toEqual(beat.after.message.windows);
    expect(sent.json.note).toBe(beat.after.message.note);
    expect("shared" in sent.json).toBe(false);
    expect("shared" in beat.after.message).toBe(false);
    expect(removed.json).toEqual({ id: beat.redaction.id, messageId: beat.redaction.messageId, removed: beat.redaction.removed, detail: beat.redaction.detail });
  });

  it("keeps every row of the README's table, in its order, with Kai and the receipt added", () => {
    const readme = read("README.md");
    const table = readme.slice(readme.indexOf("## What is real and what is seeded"), readme.indexOf("## What we built versus what we used"));
    const firstCells = table
      .split("\n")
      .filter((line) => line.startsWith("| ") && !line.startsWith("| Real") && !line.startsWith("|---"))
      .map((line) => line.split("|")[1].trim());
    const ours = realCopy.rows.map(([real]) => real as string);
    for (const cell of firstCells) {
      const stem = cell.replace(/"Replay"/, "\\\"Replay\\\"").slice(0, 30);
      expect(ours.some((row) => row.startsWith(stem.replace(/\\"/g, '"')))).toBe(true);
    }
    expect(realCopy.rows.some(([, seeded]) => seeded.includes("Kai is played by a model"))).toBe(true);
    expect(realCopy.rows.some(([, seeded]) => seeded.includes("seeded sample, labeled seeded"))).toBe(true);
  });

  it("quotes the README's two paragraphs of what is ours and what is used", () => {
    // The README sets package names in code spans; the page sets them as words.
    const readme = read("README.md").replace(/`/g, "");
    for (const paragraph of builtCopy.paragraphs) expect(readme).toContain(paragraph.text);
  });
});

describe("the entry points", () => {
  const snapshot = toUiSnapshot(snapshotAtPlanState("awaiting_humans"), { mode: "live" });

  it("is linked from the stage header, which already pointed at it", () => {
    expect(renderToStaticMarkup(createElement(TopBar, { snapshot }))).toContain(`href="${HOW_PATH}"`);
  });

  it("is linked from the JSON drawer's footer, to the protocol section, left of Copy JSON", () => {
    const drawer = renderToStaticMarkup(
      createElement(JsonDrawer, { message: snapshot.messages[0], budget: null, names: namesFor(snapshot), onClose: () => undefined }),
    );
    const link = drawer.indexOf(`href="${HOW_PATH}#${HOW_ANCHORS.protocol}"`);
    expect(link).toBeGreaterThan(-1);
    expect(drawer).toContain(howCopy.drawerLink);
    expect(link).toBeLessThan(drawer.indexOf("Copy JSON"));
  });

  it("is mentioned once in the README", () => {
    expect(read("README.md").match(/musefriends\.tech\/how/g)).toHaveLength(1);
  });

  it("is never linked from a phone: /a and /b stay a consumer phone", () => {
    for (const path of ["app/a/page.tsx", "app/b/page.tsx", "components/PhoneRoute.tsx", "components/MuseScreen.tsx"]) {
      expect(read(path)).not.toContain(HOW_PATH);
    }
  });
});

describe("the route", () => {
  const route = read("app/how/page.tsx");

  it("is static: no store, no model, no headers, no client state", () => {
    expect(route).not.toMatch(/"use client"|next\/headers|lib\/store|lib\/model|cookies\(|searchParams/);
    expect(read("components/HowPage.tsx")).not.toMatch(/"use client"|useState|useEffect|fetch\(/);
    expect(read("components/HowLoopDiagram.tsx")).not.toMatch(/"use client"|useState|useEffect|fetch\(/);
  });
});
