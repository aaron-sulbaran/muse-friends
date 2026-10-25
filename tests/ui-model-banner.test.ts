import { afterEach, describe, expect, it, vi } from "vitest";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { copy } from "@/lib/ui/copy";
import { modelLabel } from "@/lib/ui/model-name";
import { toUiSnapshot } from "@/lib/ui/snapshot";

describe("a model id, said as a name", () => {
  it("turns muse-spark-1.3 into Muse Spark 1.3, and the fallback into Muse Spark 1.2", () => {
    expect(modelLabel("muse-spark-1.3")).toBe("Muse Spark 1.3");
    expect(modelLabel("muse-spark-1.2")).toBe("Muse Spark 1.2");
    expect(modelLabel("muse-spark-2")).toBe("Muse Spark 2");
    expect(modelLabel("muse-spark-1.3-preview")).toBe("muse-spark-1.3-preview");
  });

  it("keeps an id it does not know readable, as it is", () => {
    expect(modelLabel("llama3")).toBe("llama3");
    expect(modelLabel("gpt-4o-mini")).toBe("gpt-4o-mini");
    expect(modelLabel("")).toBe("");
    expect(modelLabel("  muse-spark-1.3  ")).toBe("Muse Spark 1.3");
  });
});

describe("the simulated friend's banner", () => {
  afterEach(() => vi.unstubAllEnvs());
  const withMichelle = (state = snapshotAtPlanState("scheduled")) => ({ ...state, room: { ...state.room, simulatedFriend: true } });
  const sentByHer = (state: ReturnType<typeof withMichelle>) => state.messages.filter((record) => record.message.from === "lisa");

  it("reads Simulated friend, fictional, played by Muse Spark 1.3", () => {
    expect(copy.simulatedFriendBannerModel("Muse Spark 1.3")).toBe("Simulated friend, fictional, played by Muse Spark 1.3");
    expect(copy.simulatedFriendBanner).toBe("Simulated friend, fictional, played by a model");
  });

  it("names the configured model before she has taken a turn", () => {
    vi.stubEnv("MODEL_ID", undefined);
    const state = withMichelle({ ...snapshotAtPlanState("scheduled"), messages: [] });
    expect(toUiSnapshot(state, { mode: "live" }).simulatedFriendModel).toBe("muse-spark-1.3");
    vi.stubEnv("MODEL_ID", "muse-spark-1.4");
    expect(toUiSnapshot(state, { mode: "live" }).simulatedFriendModel).toBe("muse-spark-1.4");
  });

  it("names the model on her latest model-played message, so a fallback turn honestly reads the fallback", () => {
    const state = withMichelle();
    const hers = sentByHer(state);
    expect(hers.length).toBeGreaterThan(1);
    const proof = (model: string, fallbackFrom?: string) => ({ model, ...(fallbackFrom ? { fallbackFrom } : {}), responseId: "r", latencyMs: 1, inputTokens: 1, outputTokens: 1, reasoningTokens: 0 });
    const records = state.messages.map((record) => {
      if (record.message.id === hers[0].message.id) return { ...record, proof: proof("muse-spark-1.3") };
      if (record.message.id === hers[1].message.id) return { ...record, proof: proof("muse-spark-1.2", "muse-spark-1.3") };
      return record;
    });
    const snapshot = toUiSnapshot({ ...state, messages: records }, { mode: "live" });
    expect(snapshot.simulatedFriendModel).toBe("muse-spark-1.2");
    expect(modelLabel(snapshot.simulatedFriendModel ?? "")).toBe("Muse Spark 1.2");
  });

  it("ignores the other side's proofs and a message with none", () => {
    const state = withMichelle();
    const mine = state.messages.find((record) => record.message.from === "aaron");
    expect(mine).toBeDefined();
    const proof = { model: "someone-elses-model-9", responseId: "r", latencyMs: 1, inputTokens: 1, outputTokens: 1, reasoningTokens: 0 };
    const records = state.messages.map((record) => (record === mine ? { ...record, proof } : record));
    vi.stubEnv("MODEL_ID", undefined);
    expect(toUiSnapshot({ ...state, messages: records }, { mode: "live" }).simulatedFriendModel).toBe("muse-spark-1.3");
  });

  it("is left out when no simulated friend is playing", () => {
    expect(toUiSnapshot(snapshotAtPlanState("scheduled"), { mode: "live" }).simulatedFriendModel).toBeUndefined();
  });
});
