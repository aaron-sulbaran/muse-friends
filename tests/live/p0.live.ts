import { expect, it } from "vitest";
import { injectSignal, runSignalTurn } from "@/lib/agent/runtime";
import { rawShawarmaSignal } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";

// P0: one agent answers a seeded signal with a real get_my_calendar call on live Muse Spark.
it("Sprout's agent reads the reel, checks the calendar, and opens a thread", async () => {
  const store = new JsonStore(null);
  const signal = rawShawarmaSignal();
  const { contextId } = await injectSignal(store, signal);
  const result = await runSignalTurn({ store, agent: "aaron", signalId: signal.id, contextId });

  console.log("P0", JSON.stringify({ status: result.status, failure: result.failure, totalMs: result.totalMs, nudged: result.nudged, tools: result.toolCalls.map((call) => ({ name: call.name, ok: call.ok, error: call.error })), calls: result.calls.map((call) => ({ ms: call.ms, tools: call.toolNames, out: call.outputTokens })) }));
  const snapshot = await store.snapshot();
  console.log("P0-MESSAGES", JSON.stringify(snapshot.messages.map((record) => ({ ...record.message, stamp: record.stamp })), null, 1));
  console.log("P0-EVENTS", JSON.stringify(snapshot.events.map((event) => `${event.kind}: ${event.text}`), null, 1));
  console.log("P0-EXTRACTED", JSON.stringify(snapshot.signals[0].extracted));
  console.log("P0-PLAN", snapshot.plans[0].state, snapshot.threads[0]?.state);

  expect(result.status).toBe("completed");
  expect(result.toolCalls.map((call) => call.name)).toContain("get_my_calendar");
  expect(snapshot.messages).toHaveLength(1);
}, 120_000);
