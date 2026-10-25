import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonStore } from "@/lib/store/json";
import { getStore } from "@/lib/store";
import { StateSnapshot } from "@/lib/protocol";
import { recordedSnapshot, seedSnapshot, shawarmaRun } from "@/lib/seed/fixtures";

const tempFile = () => path.join(mkdtempSync(path.join(tmpdir(), "muse-store-")), "store.json");

describe("JsonStore", () => {
  it("starts from the seed: policies, clock, room, nothing else", async () => {
    const store = new JsonStore(null);
    const snapshot = await store.snapshot();
    expect(StateSnapshot.safeParse(snapshot).success).toBe(true);
    expect(snapshot.policies).toHaveLength(2);
    expect(snapshot.messages).toHaveLength(0);
    expect(snapshot.room.id).toBe("demo");
  });

  it("loads a recorded snapshot and reads it back by collection", async () => {
    const store = new JsonStore(null);
    await store.replaceAll(recordedSnapshot());
    expect((await store.listMessages()).map((record) => record.message.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await store.getThread("ctx_shawarma_001")).toMatchObject({ messageCount: 6 });
    expect(await store.getPlanByContext("ctx_shawarma_001")).toMatchObject({ id: "plan_shawarma_001", state: "awaiting_humans" });
    expect((await store.listCards({ forAgent: "lisa" })).map((card) => card.id)).toEqual(["card_shawarma_lisa"]);
    expect(await store.listEvents({ contextId: "nope" })).toEqual([]);
    expect(await store.getPolicy("lisa", "aaron")).toMatchObject({ tier: "close" });
    expect(await store.getPolicy("aaron", "aaron")).toBeNull();
    expect((await store.listRejectedWindows("ctx_shawarma_001")).length).toBe(2);
  });

  it("ignores a message appended twice for the same thread position", async () => {
    const store = new JsonStore(null);
    const [first] = recordedSnapshot().messages;
    await store.appendMessage(first);
    await store.appendMessage({ ...first, httpStatus: 500 });
    expect(await store.listMessages()).toHaveLength(1);
  });

  it("rewrites a stored message in place, keeping its position", async () => {
    const store = new JsonStore(null);
    await store.replaceAll(recordedSnapshot());
    const [, second] = await store.listMessages();
    await store.replaceMessage({ ...second, stamp: { ...second.stamp, removed: ["location"] } });
    const messages = await store.listMessages();
    expect(messages).toHaveLength(6);
    expect(messages[1].stamp.removed).toEqual(["location"]);
    expect(messages.map((record) => record.message.seq)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("keeps the rejected-window ledger free of duplicates", async () => {
    const store = new JsonStore(null);
    await store.addRejectedWindow("ctx", "w_1");
    await store.addRejectedWindow("ctx", "w_1");
    await store.addRejectedWindow("ctx", "w_2");
    expect(await store.listRejectedWindows("ctx")).toEqual(["w_1", "w_2"]);
  });

  it("changes its cursor on every write and not on reads", async () => {
    const store = new JsonStore(null);
    const before = await store.cursor();
    await store.snapshot();
    expect(await store.cursor()).toBe(before);
    await store.setClock({ now: "2026-10-27T16:00:00-05:00" });
    expect(await store.cursor()).not.toBe(before);
  });

  it("hands out copies, so callers cannot mutate stored state", async () => {
    const store = new JsonStore(null);
    const policy = (await store.getPolicy("lisa", "aaron"))!;
    policy.categories.location = false;
    expect((await store.getPolicy("lisa", "aaron"))!.categories.location).toBe(true);
  });

  it("stores busy blocks, the room, and the clock", async () => {
    const store = new JsonStore(null);
    const event = { id: "busy-1", title: "Dentist", start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00", private: true };
    await store.addBusy({ agent: "aaron", event });
    await store.addBusy({ agent: "lisa", event: { ...event, id: "busy-2" } });
    expect(await store.listBusy("aaron")).toEqual([{ agent: "aaron", event }]);
    expect(await store.listBusy()).toHaveLength(2);
    await store.putRoom({ id: "demo", simulatedFriend: true, resetCount: 1, updatedAt: "2026-10-25T14:00:00-05:00" });
    expect(await store.getRoom()).toMatchObject({ simulatedFriend: true });
  });

  it("keeps recorded runs across a replace", async () => {
    const store = new JsonStore(null);
    await store.saveRecordedRun(shawarmaRun());
    await store.replaceAll(seedSnapshot());
    expect(await store.getRecordedRun("run_shawarma_scripted")).toMatchObject({ scenario: "shawarma" });
    expect(await store.listRecordedRuns()).toHaveLength(1);
  });

  it("rejects a malformed snapshot", async () => {
    const store = new JsonStore(null);
    await expect(store.replaceAll({ ...seedSnapshot(), clock: { now: "yesterday" } })).rejects.toThrow();
  });

  describe("on disk", () => {
    it("persists across instances", async () => {
      const file = tempFile();
      const first = new JsonStore(file);
      await first.replaceAll(recordedSnapshot());
      await first.saveRecordedRun(shawarmaRun());
      const second = new JsonStore(file);
      expect(await second.listMessages()).toHaveLength(6);
      expect(await second.getRecordedRun("run_shawarma_scripted")).not.toBeNull();
    });

    it("writes valid JSON atomically", async () => {
      const file = tempFile();
      await new JsonStore(file).setClock({ now: "2026-10-27T16:00:00-05:00" });
      expect(JSON.parse(readFileSync(file, "utf8")).snapshot.clock.now).toBe("2026-10-27T16:00:00-05:00");
      expect(readdirSync(path.dirname(file))).toEqual(["store.json"]);
    });

    it("sets a corrupt file aside and starts from the seed", async () => {
      const file = tempFile();
      writeFileSync(file, "{not json");
      const store = new JsonStore(file);
      expect((await store.snapshot()).messages).toHaveLength(0);
      expect(readdirSync(path.dirname(file)).some((name) => name.startsWith("store.json.corrupt-"))).toBe(true);
    });
  });
});

describe("getStore", () => {
  it("returns one shared instance", async () => {
    process.env.STORE_PATH = tempFile();
    const [one, two] = await Promise.all([getStore(), getStore()]);
    expect(one).toBe(two);
  });
});
