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

describe("the You asked row in Activity", () => {
  it("says what was asked and shows the tools the Muse called under it, with what each returned", () => {
    const html = render(asked);
    expect(html).toContain("You asked your Muse");
    expect(html).toContain("You asked: Why Tuesday and not Thursday?");
    expect(html).toContain("Tools called");
    expect(html).toContain("get_plan");
    expect(html).toContain("get_sharing");
    expect(html).toContain("Shawarma Point, Tue 6 to 8 PM");
  });

  it("shows no tools list when the answer used none", () => {
    expect(render({ ...asked, toolCalls: [] })).not.toContain("Tools called");
    expect(render({ ...asked, toolCalls: undefined })).not.toContain("Tools called");
  });

  it("leaves every other row as it was", () => {
    const other: UiNote = { id: "n1", kind: "policy_changed", at: "2026-10-25T14:00:00-05:00", text: "Sprout changed sharing" };
    expect(render(other)).not.toContain("Tools called");
    expect(render(other)).toContain("Changed sharing");
  });
});
