import { expect } from "vitest";
import { resetDemo, setSharePolicy } from "@/lib/agent/controls";
import { advanceClock, decide, recordHandoff } from "@/lib/agent/lifecycle";
import { describeWindow } from "@/lib/agent/windows";
import {
  categoriesInMessage,
  type ActivityEvent,
  type AgentId,
  type MessageRecord,
  type Redaction,
  type SharePolicy,
  type StateSnapshot,
} from "@/lib/protocol";
import { PRIVATE_STRINGS } from "@/lib/seed/fixtures";
import type { LiveRunStats, PrivacyBeat } from "@/lib/seed/live";
import type { JsonStore } from "@/lib/store/json";

// The shawarma scenario, driven the same way for `pnpm demo:run` and `pnpm demo:record`: the reel through
// the real signals handler, both agents live on Muse Spark through the real inbox handler, then the people,
// the handoff, the demo clock, and the privacy replay. See tests/live/demo.live.ts for what is real.

export const ORIGIN = "http://demo.local";
const QUEUE_KEY = "__demoAfterQueue";

type Queue = Array<() => unknown>;
export function afterQueue(): Queue {
  const holder = globalThis as unknown as Record<string, Queue | undefined>;
  return (holder[QUEUE_KEY] ??= []);
}
// Stands in for next/server's after(): callbacks wait here until the run drains them one at a time.
export const mockAfter = (callback: () => unknown) => void afterQueue().push(callback);

export function installWire(): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const match = /^\/api\/agents\/([^/]+)\/inbox$/.exec(url.pathname);
    if (url.origin !== ORIGIN || !match) return realFetch(input, init);
    const { POST } = await import("@/app/api/agents/[id]/inbox/route");
    return POST(new Request(url, init), { params: Promise.resolve({ id: match[1] }) });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

export type ScenarioReport = {
  ackMs: number;
  agreedMs: number;
  stateAtEnd: string;
  replayed: number;
  leaks: string[];
  rows: LiveRunStats["perMessage"];
  notes: Array<{ windows: string; note: string }>;
  // The state just before the privacy toggle, for recording.
  beforeToggle: StateSnapshot;
  privacyBeat: PrivacyBeat | null;
};

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

const hasLocation = (record: MessageRecord) => categoriesInMessage(record.message).includes("location");

export async function runScenario(store: JsonStore, label: string, options: { toggleOwner?: AgentId | "auto" } = {}): Promise<ScenarioReport> {
  const started = Date.now();
  const arrivals: number[] = [];
  const append = store.appendMessage.bind(store);
  store.appendMessage = async (record) => {
    const before = (await store.listMessages()).length;
    await append(record);
    if ((await store.listMessages()).length > before) arrivals.push(Date.now() - started);
  };
  const queue = afterQueue();
  queue.length = 0;

  // 1. The reel arrives.
  const { POST: postSignal } = await import("@/app/api/signals/route");
  const ackStarted = Date.now();
  const ack = await postSignal(new Request(`${ORIGIN}/api/signals`, { method: "POST", body: "{}" }));
  const ackMs = Date.now() - ackStarted;
  expect(ack.status).toBe(202);
  const { contextId, planId } = (await ack.json()) as { contextId: string; planId: string };

  // 2. The agents talk: run each queued step, which may queue the next one.
  while (queue.length > 0) await queue.shift()!();

  const plan = (await store.getPlan(planId))!;
  const records = await store.listMessages(contextId);
  const agreedMs = arrivals.at(-1) ?? 0;
  expect(plan.state, `${label}: plan state after the agents finished`).toBe("awaiting_humans");
  expect(records.length, `${label}: messages to agreement`).toBeLessThanOrEqual(4);
  expect(records.every((record) => record.proof), `${label}: every message carries model proof`).toBe(true);
  expect(await store.listCards({ planId }), `${label}: a card each`).toHaveLength(2);

  // 3. The people decide, open the draft, and the demo clock carries the plan to the follow-up.
  const [first, second] = await Promise.all([
    decide(store, { planId, agent: "aaron", choice: "accept" }),
    decide(store, { planId, agent: "lisa", choice: "accept" }),
  ]);
  expect([first.ok, second.ok]).toEqual([true, true]);
  expect((await store.getPlan(planId))?.state).toBe("confirmed");
  const handoff = await recordHandoff(store, { planId, agent: "aaron", via: "whatsapp" });
  expect(handoff.ok && handoff.value.plan.state).toBe("scheduled");
  expect((await advanceClock(store, { step: "reminder" })).ok).toBe(true);
  expect((await advanceClock(store, { step: "next_day" })).ok).toBe(true);
  const final = (await store.getPlan(planId))!;
  expect(final.state).toBe("followed_up");
  // The clock alone no longer counts it; only a person's "We went!" tap does (the outcome route).
  expect((await store.listEvents()).filter((event) => event.kind === "followed_through")).toHaveLength(0);

  // 4. The privacy toggle: someone stops sharing location, and what they already sent replays under it.
  const beforeToggle = await store.snapshot();
  const requested = options.toggleOwner ?? "aaron";
  const owner: AgentId | null =
    requested === "auto"
      ? // The demo's switch is on Mochi's side, so prefer her message; fall back to whoever shared a location.
        (beforeToggle.messages.find((record) => record.message.from === "lisa" && hasLocation(record))?.message.from ??
          beforeToggle.messages.find(hasLocation)?.message.from ??
          null)
      : requested;
  let replayed = 0;
  let privacyBeat: PrivacyBeat | null = null;
  if (owner) {
    const friend: AgentId = owner === "aaron" ? "lisa" : "aaron";
    const policyBefore = (await store.getPolicy(owner, friend)) as SharePolicy;
    const toggled = await setSharePolicy(store, { owner, friend, categories: { location: false } });
    expect(toggled.ok).toBe(true);
    if (toggled.ok) {
      replayed = toggled.value.replayed.length;
      const redaction: Redaction | undefined = toggled.value.replayed[0];
      if (redaction) {
        const afterRecords = await store.listMessages(contextId);
        const original = beforeToggle.messages.find((record) => record.message.id === redaction.messageId)!;
        const rewritten = afterRecords.find((record) => record.message.id === redaction.messageId)!;
        const events: ActivityEvent[] = (await store.listEvents()).slice(beforeToggle.events.length);
        privacyBeat = { owner, friend, policyBefore, policyAfter: toggled.value.policy, before: original, after: rewritten, redaction, events };
      }
    }
  }

  // 5. Nothing private crossed the wire.
  const delivered = JSON.stringify((await store.listMessages(contextId)).map((record) => record.message));
  const leaks = Object.values(PRIVATE_STRINGS).flat().filter((secret) => delivered.toLowerCase().includes(secret.toLowerCase()));
  expect(leaks, `${label}: private strings delivered`).toEqual([]);

  const rows = records.map((record, index) => ({
    seq: record.message.seq,
    from: record.message.from,
    type: record.message.type,
    arrivalMs: arrivals[index] ?? 0,
    turnMs: (arrivals[index] ?? 0) - (arrivals[index - 1] ?? 0),
    callMs: record.proof?.latencyMs ?? 0,
    outputTokens: record.proof?.outputTokens ?? 0,
    reasoningTokens: record.proof?.reasoningTokens ?? 0,
  }));
  const notes = records.map((record) => ({ windows: (record.message.windows ?? []).map(describeWindow).join(", "), note: record.message.note ?? "" }));
  return { ackMs, agreedMs, stateAtEnd: final.state, replayed, leaks, rows, notes, beforeToggle, privacyBeat };
}

export function printReport(label: string, report: ScenarioReport) {
  const name = (agent: string) => (agent === "aaron" ? "Sprout" : "Mochi");
  const lines = [
    `DEMO ${label}: signal acknowledged in ${report.ackMs}ms; agents agreed in ${report.rows.length} messages at ${seconds(report.agreedMs)}; plan ended ${report.stateAtEnd}; privacy replay changed ${report.replayed} message(s); private strings delivered: ${report.leaks.length}`,
    "  #  from    type    arrival  turn    send call  out tok  windows / note",
    ...report.rows.map(
      (row, index) =>
        `  ${row.seq}  ${name(row.from).padEnd(6)}  ${row.type.padEnd(6)}  ${seconds(row.arrivalMs).padStart(7)}  ${seconds(row.turnMs).padStart(6)}  ${seconds(row.callMs).padStart(9)}  ${String(row.outputTokens).padStart(7)}  ${report.notes[index].windows}${report.notes[index].note ? ` | "${report.notes[index].note}"` : ""}`,
    ),
  ];
  console.log(lines.join("\n"));
}

export async function resetBetweenRuns(store: JsonStore) {
  await resetDemo(store);
}
