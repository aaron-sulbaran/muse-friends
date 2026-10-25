import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgreedLine } from "@/components/AgreedLine";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { viewForRole } from "@/lib/ui/chat";
import { copy } from "@/lib/ui/copy";
import { toUiSnapshot } from "@/lib/ui/snapshot";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const render = (names: string[], count: number) => renderToStaticMarkup(createElement(AgreedLine, { names, count, onOpen: () => {} }));

// Aaron's default for the human-connection line (pitch plan 5b): the agents agreed so that the two friends actually go.
describe("the line under the plan card says the two friends actually go", () => {
  it("names who agreed and in how many messages, then says the two of you actually go, then See how", () => {
    expect(text(render(["Sprout", "Mochi"], 3))).toBe("Sprout and Mochi agreed in 3 messages, so you two actually go. See how");
  });

  it("says message for one", () => {
    expect(text(render(["Sprout", "Mochi"], 1))).toBe("Sprout and Mochi agreed in 1 message, so you two actually go. See how");
  });

  it("keeps See how a button that opens Activity", () => {
    const html = render(["Sprout", "Mochi"], 3);
    expect(html).toContain("<button");
    expect(html).toContain("See how");
  });

  it("is built from the copy, with the names and the count passed in", () => {
    expect(copy.agreedLine("Sprout and Mochi", 4)).toBe("Sprout and Mochi agreed in 4 messages, so you two actually go.");
    expect(copy.agreedLine("Sprout and Mochi", 1)).toBe("Sprout and Mochi agreed in 1 message, so you two actually go.");
    expect(copy.agreedSeeHow).toBe("See how");
  });
});

describe("the closing line says the two friends are actually going", () => {
  it("is Done. You two are actually going. It's in Goals.", () => {
    expect(copy.closingLine).toBe("Done. You two are actually going. It's in Goals.");
  });

  it("is the line the chat draws when the plan is done, with its check", () => {
    const view = viewForRole(toUiSnapshot(snapshotAtPlanState("followed_up"), { mode: "live" }), "a");
    const closing = view.items.filter((item) => item.kind === "collapsed" && item.id === "closing");
    expect(closing.length).toBeGreaterThan(0);
    for (const item of closing) expect(item.kind === "collapsed" && item.text).toBe("Done. You two are actually going. It's in Goals.");
  });

  it("has no em dash", () => {
    for (const line of [copy.agreedLine("Sprout and Mochi", 3), copy.agreedSeeHow, copy.closingLine]) expect(line).not.toMatch(new RegExp(String.fromCharCode(0x2014)));
  });
});
