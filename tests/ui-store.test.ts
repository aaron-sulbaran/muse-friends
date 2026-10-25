import { describe, expect, it } from "vitest";
import { resetDemo, setSharePolicy } from "@/lib/agent/controls";
import { advanceClock, decide, recordHandoff } from "@/lib/agent/lifecycle";
import { SHAWARMA_PLAN_ID, recordedSnapshot } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import { viewForRole } from "@/lib/ui/chat";
import { toUiSnapshot } from "@/lib/ui/snapshot";

const live = { mode: "live" } as const;

async function freshStore() {
  const store = new JsonStore(null);
  await store.replaceAll(recordedSnapshot());
  return store;
}

async function ui(store: JsonStore) {
  return toUiSnapshot(await store.snapshot(), live);
}

describe("the UI over Lane A's real lifecycle and controls", () => {
  it("walks from both yeses to the follow-up, and the counter reads 1 only once the plan happened", async () => {
    const store = await freshStore();
    await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "aaron", choice: "accept" });
    expect((await ui(store)).plan?.state).toBe("awaiting_humans");
    await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "lisa", choice: "accept" });
    expect((await ui(store)).plan?.state).toBe("confirmed");
    await recordHandoff(store, { planId: SHAWARMA_PLAN_ID, agent: "aaron", via: "whatsapp" });
    expect((await ui(store)).plan?.state).toBe("scheduled");
    await advanceClock(store, { step: "reminder" });
    const reminded = await ui(store);
    expect(reminded.plan?.state).toBe("reminded");
    expect(reminded.clockSimulated).toBe(true);
    expect(reminded.followThrough.events).toHaveLength(0);
    await advanceClock(store, { step: "next_day" });
    const followedUp = await ui(store);
    expect(followedUp.plan?.state).toBe("followed_up");
    expect(followedUp.followThrough.events).toHaveLength(1);
  });

  it("shows the sharing replay in place: same message, withheld stamp, card says place kept private", async () => {
    const store = await freshStore();
    const before = await ui(store);
    expect(before.messages[1].removed).toEqual([]);
    expect(before.plan?.placeWithheld).toBe(false);
    await setSharePolicy(store, { owner: "lisa", friend: "aaron", categories: { location: false } });
    const after = await ui(store);
    expect(after.messages).toHaveLength(before.messages.length);
    expect(after.messages[1].id).toBe(before.messages[1].id);
    expect(after.messages[1].removed).toContain("location");
    expect(after.messages[1].shared).not.toContain("location");
    expect(after.plan?.place).toBeNull();
    expect(after.plan?.placeWithheld).toBe(true);
    expect(after.sharing.lisa.categories.location).toBe(false);
    expect(after.notes.map((note) => note.kind)).toContain("policy_changed");
  });

  it("a person's no drops the plan and the other phone says so", async () => {
    const store = await freshStore();
    await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "lisa", choice: "decline" });
    const snapshot = await ui(store);
    expect(snapshot.plan?.state).toBe("dropped");
    expect(viewForRole(snapshot, "a").items.find((item) => item.kind === "bubble" && item.id === "dropped")).toMatchObject({ text: "Mochi said not now." });
  });

  it("a reset empties the stage and keeps nothing of the old plan", async () => {
    const store = await freshStore();
    await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "aaron", choice: "accept" });
    await resetDemo(store);
    const snapshot = await ui(store);
    expect(snapshot.plan).toBeNull();
    expect(snapshot.messages).toEqual([]);
    expect(snapshot.notes.every((note) => note.kind !== "caption_extracted")).toBe(true);
    expect(snapshot.followThrough.events).toHaveLength(0);
  });
});

describe("a simulated friend is Michelle in every sentence about her", () => {
  it("renames the persona in the draft, notes, and timeline text, and leaves the raw message as sent", async () => {
    const store = await freshStore();
    await store.putRoom({ ...(await store.getRoom()), simulatedFriend: true });
    await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "aaron", choice: "accept" });
    await decide(store, { planId: SHAWARMA_PLAN_ID, agent: "lisa", choice: "accept" });
    const snapshot = await ui(store);
    expect(snapshot.plan?.draft).toContain("Hey Michelle");
    expect(snapshot.plan?.draft).not.toContain("Mochi");
    expect(snapshot.notes.map((note) => note.text).join(" ")).not.toContain("Mochi");
    expect(snapshot.messages[0].note).not.toContain("Mochi");
    expect(JSON.stringify(snapshot.messages[0].raw)).toContain("Mochi");
  });

  it("leaves the text alone when the friend is real", async () => {
    const store = await freshStore();
    const snapshot = await ui(store);
    expect(snapshot.plan?.draft).toContain("Hey Mochi");
  });
});
