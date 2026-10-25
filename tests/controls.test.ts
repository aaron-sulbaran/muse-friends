import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as postControls } from "@/app/api/controls/route";
import { categoriesForTier } from "@/lib/agent/controls";
import { CATEGORIES, TIER_DEFAULTS, isCategoryAllowed } from "@/lib/protocol";
import { seedSnapshot } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";

// The controls route against a real JsonStore, the way the app runs it.
let store: JsonStore;
beforeEach(async () => {
  store = new JsonStore(null);
  await store.replaceAll(seedSnapshot());
  (globalThis as { __museStore?: Promise<JsonStore> }).__museStore = Promise.resolve(store);
});
afterEach(() => {
  delete (globalThis as { __museStore?: unknown }).__museStore;
});

const send = (body: unknown) => postControls(new Request("http://localhost/api/controls", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const answer = async (response: Response) => ({ status: response.status, body: (await response.json()) as { data: { sharing: { tier: string; categories: Record<string, boolean> } } | null; error: { message: string } | null } });
const allowed = async (owner: "aaron" | "lisa", friend: "aaron" | "lisa") => {
  const policy = await store.getPolicy(owner, friend);
  return Object.fromEntries(CATEGORIES.map((category) => [category, isCategoryAllowed(policy, category)]));
};

describe("categoriesForTier", () => {
  it("turns on food, location, events and interests for a close friend", () => {
    expect(categoriesForTier("close")).toMatchObject({ food: true, location: true, events: true, interests: true });
  });

  it("turns on restaurants and food only for a friend", () => {
    expect(categoriesForTier("friend")).toMatchObject({ food: true, location: false, events: false, interests: false });
  });

  it("turns everything off for off", () => {
    expect(Object.values(categoriesForTier("off")).every((on) => !on)).toBe(true);
  });

  it("keeps free times on for any tier above off, the one thing the Muses need to find a day", () => {
    expect(categoriesForTier("close").availability).toBe(true);
    expect(categoriesForTier("friend").availability).toBe(true);
    expect(categoriesForTier("off").availability).toBe(false);
  });

  it("is the protocol's one tier table, not a second one", () => {
    for (const tier of ["close", "friend", "off"] as const) expect(categoriesForTier(tier)).toEqual(TIER_DEFAULTS[tier]);
  });
});

describe("sharing on side a, the judge's own Muse", () => {
  it("writes side a's policy for a tier, with the tier's categories", async () => {
    const result = await answer(await send({ type: "privacy", side: "a", tier: "friend" }));
    expect(result.status).toBe(200);
    expect(result.body.data?.sharing.tier).toBe("friend");
    expect(await allowed("aaron", "lisa")).toEqual(categoriesForTier("friend"));
  });

  it("leaves the other side's policy alone", async () => {
    const before = await store.getPolicy("lisa", "aaron");
    await send({ type: "privacy", side: "a", tier: "friend" });
    expect(await store.getPolicy("lisa", "aaron")).toEqual(before);
  });

  it("switches one category on side a", async () => {
    const result = await answer(await send({ type: "privacy", side: "a", category: "food", on: false }));
    expect(result.status).toBe(200);
    expect((await allowed("aaron", "lisa")).food).toBe(false);
    expect((await allowed("aaron", "lisa")).events).toBe(true);
  });

  it("keeps free times and the Off tier on, as on side b", async () => {
    expect((await answer(await send({ type: "privacy", side: "a", category: "availability", on: false }))).status).toBe(409);
    expect((await answer(await send({ type: "privacy", side: "a", tier: "off" }))).status).toBe(409);
  });

  it("still refuses a side that is not a or b", async () => {
    expect((await answer(await send({ type: "privacy", side: "c", tier: "close" }))).status).toBe(400);
  });
});

describe("a tier pick refills the switches, so the two sheets never disagree", () => {
  it("side b: a tier set after a switch was flipped wins, and the switches match the tier", async () => {
    await send({ type: "privacy", side: "b", category: "location", on: false });
    await send({ type: "privacy", side: "b", tier: "friend" });
    expect(await allowed("lisa", "aaron")).toEqual(categoriesForTier("friend"));
    await send({ type: "privacy", side: "b", tier: "close" });
    expect(await allowed("lisa", "aaron")).toEqual(categoriesForTier("close"));
  });

  it("side a: the onboarding's tier, then the sheet's tier, then a switch, each leaves one consistent state", async () => {
    await send({ type: "privacy", side: "a", tier: "close" });
    expect(await allowed("aaron", "lisa")).toEqual(categoriesForTier("close"));
    await send({ type: "privacy", side: "a", tier: "friend" });
    expect(await allowed("aaron", "lisa")).toEqual(categoriesForTier("friend"));
    await send({ type: "privacy", side: "a", category: "events", on: true });
    expect(await allowed("aaron", "lisa")).toEqual({ ...categoriesForTier("friend"), events: true });
    expect((await store.getPolicy("aaron", "lisa"))?.tier).toBe("friend");
  });
});
