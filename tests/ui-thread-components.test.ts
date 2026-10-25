import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SenderChip, senderTag } from "@/components/SenderChip";
import { ThreadBubble } from "@/components/ThreadBubble";
import type { Sender, ThreadLine } from "@/lib/ui/thread";

const yourMuse: Sender = { kind: "your-muse", name: "Sprout", owner: "Sprout", agent: "aaron" };
const friendMuse: Sender = { kind: "friend-muse", name: "Mochi", owner: "Michelle", agent: "lisa" };
const friend: Sender = { kind: "friend", name: "Michelle", simulated: true };
const you: Sender = { kind: "you", name: "Jordan" };

const chip = (sender: Sender) => renderToStaticMarkup(createElement(SenderChip, { sender }));
const bubble = (line: Partial<ThreadLine> & { sender: Sender }, showSender: boolean) =>
  renderToStaticMarkup(createElement(ThreadBubble, { line: { id: "l1", text: "Proposed Tuesday 6 to 8 PM", ...line }, showSender }));

describe("the sender chip", () => {
  it("names a Muse and says whose it is", () => {
    expect(senderTag(yourMuse)).toBe("your Muse");
    expect(senderTag(friendMuse)).toBe("Michelle's Muse");
    expect(chip(yourMuse)).toContain("Sprout");
    expect(chip(yourMuse)).toContain("your Muse");
    expect(chip(friendMuse)).toContain("Mochi");
    expect(chip(friendMuse)).toContain("Michelle&#x27;s Muse");
  });

  it("draws a Muse as its own character and a person as a grey initial, never a Muse", () => {
    expect(chip(yourMuse)).toContain("/avatars/sprout-portrait.png");
    expect(chip(friendMuse)).toContain("/avatars/mochi-portrait.png");
    expect(chip(friend)).not.toContain("/avatars/");
    expect(chip(friend)).toContain(">M<");
  });

  it("tags a friend who is played by a model as simulated, and a real one with nothing", () => {
    expect(senderTag(friend)).toBe("simulated");
    expect(chip(friend)).toContain("simulated");
    expect(senderTag({ kind: "friend", name: "Michelle" })).toBeNull();
    expect(senderTag(you)).toBeNull();
  });
});

describe("a thread bubble", () => {
  it("puts the person's own on the right in blue, with no chip", () => {
    const html = bubble({ sender: you }, true);
    expect(html).toContain("items-end");
    expect(html).toContain("bg-bubble-user");
    expect(html).not.toContain("font-semibold text-ink");
  });

  it("puts everyone else on the left, with the chip above the first bubble of a run only", () => {
    const first = bubble({ sender: friendMuse }, true);
    expect(first).toContain("items-start");
    expect(first).toContain("Michelle&#x27;s Muse");
    const next = bubble({ sender: friendMuse }, false);
    expect(next).toContain("items-start");
    expect(next).not.toContain("Michelle&#x27;s Muse");
  });

  it("shows a Muse's private word marked only you, in a quieter bubble", () => {
    const html = bubble({ sender: yourMuse, onlyYou: true, text: "I kept location out of what I sent Mochi." }, false);
    expect(html).toContain("only you");
    expect(html).toContain("bg-group");
    expect(bubble({ sender: yourMuse }, false)).not.toContain("only you");
  });

  it("has no emoji and no em dash", () => {
    for (const sender of [yourMuse, friendMuse, friend, you]) {
      const html = bubble({ sender, onlyYou: sender === yourMuse }, true);
      expect(html).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(html).not.toMatch(/—|–/);
    }
  });
});
