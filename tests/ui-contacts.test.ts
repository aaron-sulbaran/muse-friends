import { describe, expect, it } from "vitest";
import { startFollowUp } from "@/lib/agent/followup";
import { recordedSnapshot, seedSnapshot } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import { viewForRole } from "@/lib/ui/chat";
import { followMark } from "@/lib/ui/contacts";
import { goalSteps } from "@/lib/ui/goals";
import { discInitials, namesFor } from "@/lib/ui/format";
import { toUiSnapshot } from "@/lib/ui/snapshot";

const live = { mode: "live" } as const;

async function freshStore() {
  const store = new JsonStore(null);
  await store.replaceAll(seedSnapshot());
  return store;
}

async function ui(store: JsonStore) {
  return toUiSnapshot(await store.snapshot(), live);
}

describe("who the entry offers", () => {
  it("lists Lane A's contacts with the follow graph, and nothing private", async () => {
    const { contacts } = await ui(await freshStore());
    expect(contacts.map((contact) => contact.name)).toEqual(["Jules", "Riley"]);
    expect(contacts.map((contact) => contact.mutualFollow)).toEqual([true, false]);
    expect(Object.keys(contacts[0]).sort()).toEqual(["followsYou", "id", "mutualFollow", "name", "note", "tier", "youFollow"]);
  });

  it("says the follow graph in words, including which side is missing", () => {
    expect(followMark({ youFollow: true, followsYou: true })).toBe("Follows each other");
    expect(followMark({ youFollow: false, followsYou: true })).toBe("Follows you, you don't follow back");
    expect(followMark({ youFollow: true, followsYou: false })).toBe("You follow, doesn't follow back");
    expect(followMark({ youFollow: false, followsYou: false })).toBe("Not connected");
  });
});

describe("the phone entry", () => {
  it("is on Sprout's side only, only before a plan is running, and after the shawarma card", async () => {
    const empty = await ui(await freshStore());
    const a = viewForRole(empty, "a").items.map((item) => item.kind);
    expect(a).toContain("contact-entry");
    expect(a.indexOf("start-card")).toBeLessThan(a.indexOf("contact-entry"));
    expect(viewForRole(empty, "b").items.some((item) => item.kind === "contact-entry")).toBe(false);
    expect(viewForRole(toUiSnapshot(recordedSnapshot(), live), "a").items.some((item) => item.kind === "contact-entry")).toBe(false);
  });
});

describe("a contact who does not follow back: the gate refuses", () => {
  it("records a refused plan, and the phone says so neutrally while the entry stays available", async () => {
    const store = await freshStore();
    const result = await startFollowUp(store, { target: "riley" });
    expect(result).toMatchObject({ ok: true, started: false, reason: "not_mutual" });
    const snapshot = await ui(store);
    expect(snapshot.plan).toMatchObject({ refused: true, state: "dropped", target: { id: "riley", name: "Riley" } });
    expect(snapshot.plan?.droppedReason).toBe("Sprout only reaches out to people who follow each other");
    expect(snapshot.refusal).toMatchObject({ contactName: "Riley", text: "No thread opened: you and Riley do not follow each other." });
    expect(snapshot.messages).toEqual([]);
    expect(snapshot.standIn).toBeNull();
    expect(viewForRole(snapshot, "b").museName).toBe("Mochi");

    const items = viewForRole(snapshot, "a").items;
    expect(items.find((item) => item.kind === "bubble" && item.id === "contact-chosen")).toMatchObject({ from: "user", text: "Follow up with Riley" });
    expect(items.find((item) => item.kind === "bubble" && item.id === "contact-refused")).toMatchObject({
      from: "muse",
      text: "Sprout only reaches out to people who follow each other.",
    });
    expect(items.some((item) => item.kind === "contact-entry")).toBe(true);
    expect(items.some((item) => item.kind === "bubble" && item.id === "dropped")).toBe(false);
  });

  it("leaves two plain rows on the timeline: who was asked about, and the refusal", async () => {
    const store = await freshStore();
    await startFollowUp(store, { target: "riley" });
    const { notes } = await ui(store);
    expect(notes.map((note) => note.kind)).toEqual(["contact_chosen", "contact_refused"]);
    expect(notes[1].text).toContain("do not follow each other");
  });

  it("says nothing about it on Mochi's side", async () => {
    const store = await freshStore();
    await startFollowUp(store, { target: "riley" });
    const items = viewForRole(await ui(store), "b").items;
    expect(items.some((item) => item.kind === "bubble" && item.id === "contact-refused")).toBe(false);
  });
});

describe("a mutual acquaintance: the run starts, with a smaller footprint", () => {
  it("names the contact in place of the persona, with an initial disc, and keeps the Muse a Muse", async () => {
    const store = await freshStore();
    expect(await startFollowUp(store, { target: "jules" })).toMatchObject({ ok: true, started: true });
    const snapshot = await ui(store);
    expect(snapshot.plan).toMatchObject({ refused: false, state: "detected", target: { id: "jules", name: "Jules" } });
    expect(snapshot.standIn).toEqual({ person: "Jules", muse: "Jules's Muse" });
    expect(namesFor(snapshot).human.lisa).toBe("Jules");
    expect(namesFor(snapshot).muse.lisa).toBe("Jules's Muse");
    expect(discInitials(snapshot)).toEqual({ aaron: null, lisa: "J" });
    expect(viewForRole(snapshot, "a").friendHumanName).toBe("Jules");
  });

  it("draws a grey disc for a contact but not for Michelle, whose Muse is Mochi", async () => {
    const store = await freshStore();
    await store.putRoom({ ...(await store.getRoom()), simulatedFriend: true });
    const withMichelle = await ui(store);
    expect(withMichelle.standIn).toEqual({ person: "Michelle", muse: "Michelle's Muse" });
    expect(discInitials(withMichelle)).toEqual({ aaron: null, lisa: null });
    expect(await startFollowUp(store, { target: "jules" })).toMatchObject({ ok: true, started: true });
    expect(discInitials(await ui(store))).toEqual({ aaron: null, lisa: "J" });
  });

  it("never talks about a reel: no reel in the card, the status, the goal, or phone b's chat", async () => {
    const store = await freshStore();
    await startFollowUp(store, { target: "jules" });
    const snapshot = await ui(store);
    expect(snapshot.plan?.target?.name).toBe("Jules");
    const a = viewForRole(snapshot, "a");
    expect(a.status).toEqual({ glyph: "talking", text: "reaching out to Jules" });
    expect(a.items.find((item) => item.kind === "bubble" && item.id === "contact-chosen")).toMatchObject({ from: "user", text: "Follow up with Jules" });
    const b = viewForRole(snapshot, "b");
    expect(b.items.some((item) => item.kind === "bubble" && item.id === "reel-sent")).toBe(false);
    expect(b.status).toBeNull();
    expect(goalSteps(snapshot.plan!, { friend: "Jules", reelOwner: "Jules's", muses: ["Sprout", "Jules's Muse"] })[0].detail).toBe("You asked to follow up with Jules");
  });

  it("shows the contact chosen and the sharing level on the timeline, and no entry while it runs", async () => {
    const store = await freshStore();
    await startFollowUp(store, { target: "jules" });
    const snapshot = await ui(store);
    expect(snapshot.notes.map((note) => note.kind)).toEqual(["contact_chosen", "policy_changed"]);
    expect(snapshot.notes[1].text).toContain("never location");
    expect(snapshot.sharing.lisa.tier).toBe("acquaintance");
    expect(snapshot.sharing.lisa.categories.location).toBe(false);
    expect(viewForRole(snapshot, "a").items.some((item) => item.kind === "contact-entry")).toBe(false);
  });

  it("a plan that starts after a refusal supersedes it on the phone, while the timeline keeps it", async () => {
    const store = await freshStore();
    await startFollowUp(store, { target: "riley" });
    await startFollowUp(store, { target: "jules" });
    const snapshot = await ui(store);
    expect(snapshot.refusal).toBeNull();
    expect(snapshot.notes.some((note) => note.kind === "contact_refused")).toBe(true);
  });

  it("renames the persona in human-facing text, and leaves the raw record alone", async () => {
    const store = await freshStore();
    await startFollowUp(store, { target: "jules" });
    const plan = (await store.listPlans())[0];
    await store.putPlan({ ...plan, draft: "Hey Mochi, want to get food again?" });
    const snapshot = await ui(store);
    expect(snapshot.plan?.draft).toBe("Hey Jules, want to get food again?");
    expect((await store.listPlans())[0].draft).toContain("Mochi");
  });
});
