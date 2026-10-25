// Runs `work` after every earlier call with the same key has finished, so read-modify-write sequences
// on one plan cannot interleave inside a process. Shared through globalThis so every route bundle in
// `next dev` queues on the same chain. It cannot order calls across serverless instances; the
// lifecycle functions also reconcile from durable per-person state for that case.
type Chains = Map<string, Promise<unknown>>;

export function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const shared = globalThis as typeof globalThis & { __museLocks?: Chains };
  const chains = (shared.__museLocks ??= new Map());
  const previous = chains.get(key) ?? Promise.resolve();
  const run = previous.then(work, work);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}

// One lock for everything that changes a plan after the agents agree: the demo is a single room.
export const PLAN_LOCK = "plan-lifecycle";
