import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityNote } from "@/components/ActivityNote";
import type { UiNote } from "@/lib/ui/types";

const asked: UiNote = {
  id: "evt_chat_1",
  kind: "chat_asked",
  at: "2026-10-25T14:01:00-05:00",
  text: "You asked: Why Tuesday and not Thursday?",
  answerId: "chat_2",
  toolCalls: [
    { name: "get_plan", args: "", result: "Shawarma Point, Tue 6 to 8 PM" },
    { name: "get_sharing", args: "friend: lisa", result: "tier close" },
  ],
};

const render = (note: UiNote) => renderToStaticMarkup(createElement(ActivityNote, { note }));

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

describe("the You asked row in Activity", () => {
  it("says what was asked and shows the tools the Muse called under it, in plain words", () => {
    const html = render(asked);
    expect(html).toContain("You asked your Muse");
    expect(html).toContain("You asked: Why Tuesday and not Thursday?");
    expect(text(html)).toContain("Read the plan");
    expect(text(html)).toContain("Read the sharing settings");
    // The raw names and results stay in the JSON drawer.
    expect(html).not.toContain("get_plan");
    expect(html).not.toContain("Tools called");
  });

  it("shows no tool lines when the answer used none", () => {
    expect(render({ ...asked, toolCalls: [] })).not.toContain("data-line");
    expect(render({ ...asked, toolCalls: undefined })).not.toContain("data-line");
  });

  it("leaves every other row as it was", () => {
    const other: UiNote = { id: "n1", kind: "policy_changed", at: "2026-10-25T14:00:00-05:00", text: "Sprout changed sharing" };
    expect(render(other)).not.toContain("data-line");
    expect(render(other)).toContain("Changed sharing");
  });

  it("shows a web search with what was searched and its pages as Source chips that open in a new tab, on the search's own line", () => {
    const searched: UiNote = {
      ...asked,
      toolCalls: [
        { name: "web_search", args: "best shawarma near E 6th St", result: "3 results" },
        { name: "get_plan", args: "", result: "plan awaiting_humans" },
      ],
      sources: [
        { title: "Best shawarma in Austin", url: "https://www.eater.com/austin/x", host: "eater.com" },
        { title: "Shawarma Point, Yelp", url: "https://www.yelp.com/biz/shawarma-point", host: "yelp.com" },
        { title: "CultureMap", url: "https://austin.culturemap.com/news/y", host: "austin.culturemap.com" },
      ],
    };
    const html = render(searched);
    expect(text(html)).toContain('Searched the web for "best shawarma near E 6th St": 3 results');
    expect(html.match(/<a /g)).toHaveLength(3);
    expect(html).toContain('href="https://www.eater.com/austin/x"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    // The chips sit under the search, before the next tool.
    expect(html.indexOf("eater.com")).toBeGreaterThan(html.indexOf("Searched the web"));
    expect(html.indexOf("austin.culturemap.com")).toBeLessThan(html.indexOf("Read the plan"));
  });

  it("shows no chips when the answer did not search", () => {
    expect(render(asked)).not.toContain("<a ");
  });
});
