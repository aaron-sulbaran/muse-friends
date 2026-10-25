import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PrivateAside } from "@/components/PrivateAside";
import { SenderChip, museOwnerText } from "@/components/SenderChip";
import { Thread } from "@/components/Thread";
import { ThreadBubble } from "@/components/ThreadBubble";
import { copy } from "@/lib/ui/copy";
import type { Sender, ThreadLine } from "@/lib/ui/thread";

const yourMuse: Sender = { kind: "your-muse", name: "Sprout", owner: "Sprout", agent: "aaron" };
const friendMuse: Sender = { kind: "friend-muse", name: "Mochi", owner: "Michelle", agent: "lisa" };
const friend: Sender = { kind: "friend", name: "Michelle", simulated: true };
const you: Sender = { kind: "you", name: "Jordan" };

const line = (sender: Sender, extra: Partial<ThreadLine> = {}): ThreadLine => ({ id: `l-${sender.name}-${extra.text ?? "t"}`, sender, text: "Proposed Tuesday 6 to 8 PM", ...extra });
const chip = (sender: Sender) => renderToStaticMarkup(createElement(SenderChip, { sender }));
const bubble = (thread: ThreadLine, showSender: boolean, showPicture: boolean) => renderToStaticMarkup(createElement(ThreadBubble, { line: thread, showSender, showPicture }));
const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;");

describe("the sender chip", () => {
  it("names a Muse in bold, then whose it is in plain muted text after a comma, said from the reader's side", () => {
    expect(museOwnerText(yourMuse)).toBe("your Muse");
    expect(museOwnerText(friendMuse)).toBe("Michelle's Muse");
    expect(chip(yourMuse)).toMatch(/<span class="font-semibold text-ink">Sprout<\/span><span class="text-muted">, your Muse<\/span>/);
    expect(chip(friendMuse)).toMatch(/<span class="font-semibold text-ink">Mochi<\/span><span class="text-muted">, Michelle&#x27;s Muse<\/span>/);
  });

  it("names a person alone, and tags a person played by a model Simulated, as a button that explains itself", () => {
    expect(museOwnerText(friend)).toBeNull();
    const html = chip(friend);
    expect(html).toContain("Michelle");
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>Simulated<\/button>/);
    expect(chip({ kind: "friend", name: "Michelle" })).not.toContain("Simulated");
    expect(copy.threadSimulatedCard("Michelle")).toBe("Michelle is played by a model for this demo.");
  });

  it("starts at the bubble column, 32px in", () => {
    expect(chip(yourMuse)).toContain("pl-8");
  });
});

describe("a thread bubble", () => {
  it("puts your own on the right in blue, with no chip and no picture", () => {
    const html = bubble(line(you), true, true);
    expect(html).toContain("items-end");
    expect(html).toContain("bg-bubble-user");
    expect(html).not.toContain("font-semibold text-ink");
    expect(html).not.toContain("<img");
  });

  it("tints each Muse its own colour and a person grey, so they are told apart without reading", () => {
    expect(bubble(line(yourMuse), false, false)).toContain("bg-bubble-sprout");
    expect(bubble(line(friendMuse), false, false)).toContain("bg-bubble-mochi");
    expect(bubble(line(friend), false, false)).toContain("bg-bubble-muse");
  });

  it("shows the chip on the first bubble of a run and the picture beside the last, bottom aligned", () => {
    const first = bubble(line(friendMuse), true, false);
    expect(first).toContain("Michelle&#x27;s Muse");
    expect(first).not.toContain("<img");
    const last = bubble(line(friendMuse), false, true);
    expect(last).not.toContain("Michelle&#x27;s Muse");
    expect(last).toContain("/avatars/mochi-portrait.png");
    expect(last).toContain("items-end");
  });

  it("draws a person's picture as a grey initial, never a Muse", () => {
    const html = bubble(line(friend), false, true);
    expect(html).not.toContain("/avatars/");
    expect(html).toContain(">M<");
  });

  it("sets a Muse's private word apart: white, dashed, locked, and said to be for you alone", () => {
    const html = bubble(line(yourMuse, { onlyYou: true, text: "I kept location out of what I sent Mochi." }), false, true);
    expect(html).toContain("border-dashed");
    expect(html).toContain("bg-surface");
    expect(html).toContain("Only you see this");
    expect(html).toContain("I kept location out of what I sent Mochi.");
    expect(bubble(line(yourMuse), false, true)).not.toContain("Only you see this");
  });

  it("labels your own private question with who it went to, in a dashed bubble", () => {
    const html = bubble(line(you, { onlyYou: true, to: "Sprout", text: "Why Tuesday and not Thursday?" }), false, false);
    expect(html).toContain("To Sprout, only you see this");
    expect(html).toContain("border-ask-line");
    expect(html).toContain("border-dashed");
  });

  it("has no emoji and no em dash", () => {
    for (const sender of [yourMuse, friendMuse, friend, you]) {
      for (const onlyYou of [false, true]) {
        const html = bubble(line(sender, { onlyYou, to: "Sprout" }), true, true);
        expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(html).not.toMatch(/—|–/);
      }
    }
  });
});

describe("the private aside", () => {
  it("is the dashed white card with a lock and the label", () => {
    const html = renderToStaticMarkup(createElement(PrivateAside, null, "Your budget stays with me until you answer."));
    expect(html).toContain("border-aside-line");
    expect(html).toContain(escaped("Only you see this"));
    expect(html).toContain("Your budget stays with me until you answer.");
  });
});

describe("the thread", () => {
  const thread = [
    line(friend, { text: "found this, we should go" }),
    line(yourMuse, { text: "Mochi, is Michelle free this week?" }),
    line(yourMuse, { text: "I can also check Thursday." }),
    line(friendMuse, { text: "She is free Tuesday 6 to 8." }),
  ];
  const html = renderToStaticMarkup(createElement(Thread, { lines: thread }));

  it("shows each sender's chip once per run", () => {
    expect(html.split(", your Muse").length - 1).toBe(1);
    expect(html.split("Michelle&#x27;s Muse").length - 1).toBe(1);
    expect(html.split(">Simulated<").length - 1).toBe(1);
  });

  it("puts a picture beside the last bubble of each run only", () => {
    expect(html.split('src="/avatars/sprout-portrait.png"').length - 1).toBe(1);
    expect(html.split('src="/avatars/mochi-portrait.png"').length - 1).toBe(1);
  });

  it("spaces bubbles 4px within a run and 14px between the three runs", () => {
    expect(html.split("mt-1\"").length - 1).toBe(1);
    expect(html.split("mt-3.5").length - 1).toBe(2);
  });
});
