import { JsonStore } from "@/lib/store/json";
import type { Store } from "@/lib/store";

// A Store whose every call takes `delayMs`, like a database across a slow network.
//
// `depth()` counts sequential round trips without looking at a clock: a call's level is one more than
// the highest level of any call that had finished when it started. Calls started together (one
// Promise.all) share a level, calls awaited one after another climb. So depth() is what elapsed time
// would be, divided by the delay, and it does not move when the machine is busy.
export function slowStore(delayMs: number, inner: Store = new JsonStore(null)) {
  const calls: string[] = [];
  let finishedLevel = 0;
  let deepest = 0;
  const store = new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        calls.push(String(property));
        const level = finishedLevel + 1;
        deepest = Math.max(deepest, level);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        finishedLevel = Math.max(finishedLevel, level);
        return value.apply(target, args);
      };
    },
  }) as Store;
  return {
    store,
    calls,
    depth: () => deepest,
    // Forget what happened so far, so a test measures one code path.
    reset: () => {
      calls.length = 0;
      finishedLevel = 0;
      deepest = 0;
    },
  };
}
