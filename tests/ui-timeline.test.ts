import { describe, expect, it } from "vitest";
import { recordedSnapshot } from "@/lib/seed/fixtures";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import { timelineOf } from "@/lib/ui/timeline";

const live = { mode: "live" } as const;

describe("timeline notes", () => {
  it("surfaces the caption read, the thread opening, and sharing changes as rows of their own", () => {
    const state = recordedSnapshot();
    state.events.push({ id: "evt_policy", at: state.clock.now, kind: "policy_changed", actor: "human", agent: "lisa", text: "Mochi changed sharing with Sprout: location off" });
    const kinds = toUiSnapshot(state, live).notes.map((note) => note.kind);
    expect(kinds).toEqual(["reel_source", "caption_extracted", "thread_opened", "policy_changed"]);
  });

  it("does not turn message_sent or card events into notes: messages already have rows", () => {
    const notes = toUiSnapshot(recordedSnapshot(), live).notes;
    expect(notes.every((note) => ["reel_source", "caption_extracted", "thread_opened", "policy_changed"].includes(note.kind))).toBe(true);
  });

  it("says honestly where the reel came from: the seed, or live from Instagram", () => {
    const seeded = toUiSnapshot(recordedSnapshot(), live).notes.find((note) => note.kind === "reel_source");
    expect(seeded?.text).toMatch(/^Seeded demo reel, fictional/);
    const state = recordedSnapshot();
    state.signals = state.signals.map((signal) => ({
      ...signal,
      media: { ...signal.media, username: "owner.account" },
      provenance: { ...signal.provenance, source: "instagram_graph_api" as const, fictional: false },
    }));
    const fromInstagram = toUiSnapshot(state, live);
    expect(fromInstagram.notes.find((note) => note.kind === "reel_source")?.text).toContain("read live from @owner.account through the Instagram Graph API");
    expect(fromInstagram.reel?.username).toBe("owner.account");
  });

  it("orders notes and messages by when they happened, the caption read before the first message", () => {
    const entries = timelineOf(toUiSnapshot(recordedSnapshot(), live));
    expect(entries.slice(0, 4).map((entry) => (entry.kind === "note" ? entry.note.kind : entry.message.type))).toEqual([
      "reel_source",
      "caption_extracted",
      "thread_opened",
      "intent",
    ]);
    const times = entries.map((entry) => Date.parse(entry.kind === "note" ? entry.note.at : entry.message.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe("the place on the card", () => {
  it("prefers the caption model's area over a place that only repeats the title", () => {
    const state = recordedSnapshot();
    const plan = state.plans[0];
    state.plans[0] = { ...plan, activity: { kind: "food", title: "Shawarma Point", place: "Shawarma Point" } };
    state.signals[0] = { ...state.signals[0], extracted: { source: "caption_model", model: "muse-spark-1.3", place: "Shawarma Point", area: "E 6th St", at: state.clock.now } };
    expect(toUiSnapshot(state, live).plan?.place).toBe("E 6th St");
  });

  it("shows no place at all, and does not claim it was withheld, when nothing adds to the title", () => {
    const state = recordedSnapshot();
    state.plans[0] = { ...state.plans[0], activity: { kind: "food", title: "Shawarma Point" } };
    state.signals = state.signals.map((signal) => ({ ...signal, extracted: undefined }));
    state.messages = state.messages.map((record) => ({ ...record, message: { ...record.message, activity: record.message.activity && { kind: "food", title: "Shawarma Point" } } }));
    const plan = toUiSnapshot(state, live).plan;
    expect(plan?.place).toBeNull();
    expect(plan?.placeWithheld).toBe(false);
  });

  it("says withheld only after a redaction removed location", () => {
    const state = recordedSnapshot();
    expect(toUiSnapshot(state, live).plan?.placeWithheld).toBe(false);
    state.redactions.push({
      id: "red_x",
      contextId: state.threads[0].contextId,
      messageId: state.messages[1].message.id,
      from: "lisa",
      to: "aaron",
      removed: ["location"],
      detail: "Location removed.",
      at: state.clock.now,
    });
    const plan = toUiSnapshot(state, live).plan;
    expect(plan?.place).toBeNull();
    expect(plan?.placeWithheld).toBe(true);
  });
});
