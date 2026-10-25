import type { StateSnapshot } from "@/lib/protocol";
import type { Store } from "@/lib/store";

// Every Store method that changes state. After any of them the room's snapshot is saved, so a
// check_plan from another server instance sees the negotiation as it goes.
const WRITES = new Set<string>([
  "putThread",
  "appendMessage",
  "replaceMessage",
  "putPlan",
  "putCard",
  "putPolicy",
  "appendRedaction",
  "addRejectedWindow",
  "putSignal",
  "appendEvent",
  "putRoom",
  "addBusy",
  "setClock",
  "saveRecordedRun",
  "replaceAll",
]);

export type PersistingStore = { store: Store; flush: () => Promise<void> };

// Wraps an in-memory Store so each write also saves the room's whole snapshot. Saves are coalesced: if
// one is in flight, writes made meanwhile are covered by one more save straight after it, so the
// document is never behind by more than one save. A failed save is logged and does not stop the agents;
// `flush` waits for the last one and throws if it failed.
export function persistingStore(inner: Store, save: (snapshot: StateSnapshot) => Promise<void>): PersistingStore {
  let dirty = false;
  let running: Promise<void> | null = null;
  let lastError: unknown = null;

  async function drain() {
    while (dirty) {
      dirty = false;
      try {
        await save(await inner.snapshot());
        lastError = null;
      } catch (error) {
        lastError = error;
        console.error("room save failed", error instanceof Error ? error.message : error);
      }
    }
  }

  function kick() {
    dirty = true;
    if (running) return;
    running = drain().finally(() => {
      running = null;
      if (dirty) kick();
    });
  }

  const store = new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function" || typeof property !== "string" || !WRITES.has(property)) return value;
      return async (...args: unknown[]) => {
        const result = await (value as (...inner: unknown[]) => unknown).apply(target, args);
        kick();
        return result;
      };
    },
  });

  async function flush() {
    kick();
    while (running) await running;
    if (lastError) throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  return { store, flush };
}
