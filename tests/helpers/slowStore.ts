import { JsonStore } from "@/lib/store/json";
import type { Store } from "@/lib/store";

// A Store whose every call takes `delayMs`, like a database across a slow network. Calls started
// together overlap (each waits its own delay), calls made one after another add up, so elapsed time
// counts the sequential store round trips on a code path.
export function slowStore(delayMs: number, inner: Store = new JsonStore(null)): { store: Store; calls: string[] } {
  const calls: string[] = [];
  const store = new Proxy(inner, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        calls.push(String(property));
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return value.apply(target, args);
      };
    },
  }) as Store;
  return { store, calls };
}
