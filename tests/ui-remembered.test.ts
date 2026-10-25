import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityNote } from "@/components/ActivityNote";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { viewForRole } from "@/lib/ui/chat";
import { copy } from "@/lib/ui/copy";
import { toUiSnapshot } from "@/lib/ui/snapshot";

const live = { mode: "live" } as const;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

/** The finished shawarma plan with Michelle on the other phone, after the person said "We went!". */
function went() {
  const state = snapshotAtPlanState("followed_up");
  state.room = { ...state.room, simulatedFriend: true };
  return state;
}

/** The same plan after the person said "Didn't happen" instead. */
function didnt() {
  const state = went();
  state.events = state.events.filter((event) => event.kind !== "followed_through");
  state.events.push({ id: "evt_outcome_didnt_1", at: "2026-10-27T20:05:00-05:00", kind: "human_decision", actor: "human", planId: "plan_shawarma_001", text: "Aaron said it did not happen" });
  return state;
}

const remembered = (state: ReturnType<typeof went>) => toUiSnapshot(state, live).notes.filter((note) => note.kind === "remembered");

describe("the Remembered row in Activity", () => {
  it("appears after We went!, saying who went and that the Muse will suggest it again", () => {
    const [note] = remembered(went());
    expect(note?.text).toBe("Aaron and Michelle went to Shawarma Point and liked it; Sprout will suggest a plan with Michelle again when both are free");
  });

  it("appears after Didn't happen, saying the Muse will ask before suggesting it again", () => {
    const [note] = remembered(didnt());
    expect(note?.text).toBe("Shawarma Point with Michelle did not happen; Sprout will ask before suggesting it again");
  });

  it("is there once, at the time the person answered", () => {
    expect(remembered(went())).toHaveLength(1);
    expect(remembered(went())[0]?.at).toBe("2026-10-27T20:00:00-05:00");
    expect(remembered(didnt())).toHaveLength(1);
    expect(remembered(didnt())[0]?.at).toBe("2026-10-27T20:05:00-05:00");
  });

  it("takes the names people gave, and sorts in with the other rows by its time", () => {
    const state = went();
    state.room = { ...state.room, availability: { aaron: { windows: [{ start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" }], name: "Alex", at: "2026-10-25T13:00:00-05:00" } } };
    const snapshot = toUiSnapshot(state, live);
    const note = snapshot.notes.find((entry) => entry.kind === "remembered");
    expect(note?.text).toContain("Alex and Michelle went to Shawarma Point");
    const times = snapshot.notes.map((entry) => entry.at);
    expect(times).toEqual([...times].sort());
  });

  it("is not there before the person has answered", () => {
    expect(remembered(snapshotAtPlanState("scheduled"))).toEqual([]);
    expect(remembered(snapshotAtPlanState("awaiting_humans"))).toEqual([]);
    const unanswered = went();
    unanswered.events = unanswered.events.filter((event) => event.kind !== "followed_through");
    expect(remembered(unanswered)).toEqual([]);
  });

  it("is a plain row with a title, the sentence and the time", () => {
    const [note] = remembered(went());
    const html = renderToStaticMarkup(createElement(ActivityNote, { note: note! }));
    expect(text(html)).toContain("Remembered");
    expect(text(html)).toContain("Aaron and Michelle went to Shawarma Point and liked it");
    expect(html).toContain("<svg");
  });
});

describe("the Muse's reply to the outcome", () => {
  const reply = (state: ReturnType<typeof went>) => {
    const item = viewForRole(toUiSnapshot(state, live), "a").items.find((entry) => entry.id === "outcome-reply");
    return item?.kind === "bubble" ? item.text : undefined;
  };

  it("adds that it will remember, after We went!", () => {
    expect(reply(went())).toBe("Love that. That's one plan that made it out of the chat. Awesome, I'll remember that for next time.");
  });

  it("adds that it will keep it in mind, after Didn't happen", () => {
    expect(reply(didnt())).toBe("No worries, plans slip. I'll keep Shawarma Point in mind for another time. Got it, I'll keep that in mind.");
  });

  it("has no em dash and no emoji", () => {
    const dash = new RegExp(String.fromCharCode(0x2014));
    for (const line of [copy.outcomeWentReply, copy.outcomeDidntReply("Shawarma Point"), copy.rememberedWent("Aaron", "Michelle", "Shawarma Point", "Sprout"), copy.rememberedDidnt("Michelle", "Shawarma Point", "Sprout")]) {
      expect(line).not.toMatch(dash);
      expect(line).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});
