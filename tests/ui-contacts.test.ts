import { describe, expect, it } from "vitest";
import { recordedSnapshot, seedSnapshot } from "@/lib/seed/fixtures";
import { viewForRole } from "@/lib/ui/chat";
import { fixtureContacts, followMark } from "@/lib/ui/contacts";
import { toUiSnapshot } from "@/lib/ui/snapshot";

const live = { mode: "live" } as const;

function refused(name = "Pax") {
  const state = seedSnapshot();
  state.events.push({
    id: "evt_refused",
    at: state.clock.now,
    kind: "message_rejected",
    actor: "system",
    text: `Sprout did not start a thread with ${name}: you do not follow each other`,
  });
  return state;
}

describe("who the entry offers", () => {
  it("lists a friend, a mutual acquaintance, and one who does not follow back", () => {
    const byTier = (tier: string) => fixtureContacts.filter((contact) => contact.tier === tier);
    expect(byTier("friend").every((contact) => contact.mutualFollow)).toBe(true);
    expect(byTier("acquaintance").some((contact) => contact.mutualFollow)).toBe(true);
    expect(byTier("acquaintance").some((contact) => !contact.mutualFollow)).toBe(true);
  });

  it("says the mutual-follow fact in words", () => {
    expect(followMark({ ...fixtureContacts[0], mutualFollow: true })).toBe("Follows each other");
    expect(followMark({ ...fixtureContacts[0], mutualFollow: false })).toBe("Doesn't follow back");
  });

  it("hands the UI only name, tier, mutual flag, and note: no calendar, no policy", () => {
    const [contact] = toUiSnapshot(seedSnapshot(), live).contacts;
    expect(Object.keys(contact).sort()).toEqual(["id", "mutualFollow", "name", "note", "tier"]);
  });
});

describe("the phone entry", () => {
  it("is on Sprout's side only, and only before a plan exists", () => {
    const empty = toUiSnapshot(seedSnapshot(), live);
    expect(viewForRole(empty, "a").items.some((item) => item.kind === "contact-entry")).toBe(true);
    expect(viewForRole(empty, "b").items.some((item) => item.kind === "contact-entry")).toBe(false);
    const running = toUiSnapshot(recordedSnapshot(), live);
    expect(viewForRole(running, "a").items.some((item) => item.kind === "contact-entry")).toBe(false);
  });

  it("keeps the main demo path first: the simulated-friend card comes before the extra entry", () => {
    const items = viewForRole(toUiSnapshot(seedSnapshot(), live), "a").items.map((item) => item.kind);
    expect(items.indexOf("start-card")).toBeLessThan(items.indexOf("contact-entry"));
  });
});

describe("when the gate refuses", () => {
  it("shows the person's choice and a neutral line, and nothing started", () => {
    const snapshot = toUiSnapshot(refused(), live);
    expect(snapshot.refusal).toMatchObject({ contactName: "Pax" });
    expect(snapshot.plan).toBeNull();
    const items = viewForRole(snapshot, "a").items;
    expect(items.find((item) => item.kind === "bubble" && item.id === "contact-chosen")).toMatchObject({ from: "user", text: "Follow up with Pax" });
    expect(items.find((item) => item.kind === "bubble" && item.id === "contact-refused")).toMatchObject({
      from: "muse",
      text: "Sprout only reaches out to people who follow each other.",
    });
  });

  it("leaves a plain row on the timeline, not a message and not a thread", () => {
    const snapshot = toUiSnapshot(refused(), live);
    expect(snapshot.notes.map((note) => note.kind)).toEqual(["contact_refused"]);
    expect(snapshot.messages).toEqual([]);
  });

  it("does not show the refusal on Mochi's side", () => {
    const items = viewForRole(toUiSnapshot(refused(), live), "b").items;
    expect(items.some((item) => item.kind === "bubble" && item.id === "contact-refused")).toBe(false);
  });

  it("a plan that starts afterwards supersedes the refusal on the phone, while the timeline keeps it", () => {
    const state = recordedSnapshot();
    state.events.unshift({ id: "evt_refused", at: state.clock.now, kind: "message_rejected", actor: "system", text: "Sprout did not start a thread with Pax: you do not follow each other" });
    const snapshot = toUiSnapshot(state, live);
    expect(snapshot.refusal).toBeNull();
    expect(snapshot.notes.some((note) => note.kind === "contact_refused")).toBe(true);
  });

  it("a rejected message in a thread is not a refusal", () => {
    const state = recordedSnapshot();
    state.events.push({ id: "evt_rej", at: state.clock.now, kind: "message_rejected", actor: "system", contextId: state.threads[0].contextId, messageId: state.messages[0].message.id, text: "Blocked at the inbox" });
    expect(toUiSnapshot(state, live).notes.some((note) => note.kind === "contact_refused")).toBe(false);
  });
});
