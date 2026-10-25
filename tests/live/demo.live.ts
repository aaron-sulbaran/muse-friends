import { writeFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { recordCurrentRun, resetDemo, setSharePolicy } from "@/lib/agent/controls";
import { advanceClock, decide, recordHandoff } from "@/lib/agent/lifecycle";
import { describeWindow } from "@/lib/agent/windows";
import { PRIVATE_STRINGS } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";

// The scripted demo: the shawarma scenario from the reel to the next-day follow-up on live Muse Spark.
//
//   pnpm demo:run                      one run
//   DEMO_RUNS=2 pnpm demo:run          the C3 "passes twice" check
//   DEMO_RECORD=data/demo-run.json     also save the last run as a Replay file (RecordedRun JSON)
//
// What it exercises for real: the Responses loop on Muse Spark for both agents, the signals route, the
// bearer-authenticated inbox route (a fetch shim hands each POST to the route handler, so tokens,
// validation, and the 202-then-turn flow all run), the send checks, the share policy, cards, human
// decisions, handoff, hold, the demo clock, and the privacy replay. What it does not: a real network
// hop or the Vercel runtime, so `after()` callbacks are queued and run one at a time here.

const queued: Array<() => unknown> = [];
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (callback: () => unknown) => void queued.push(callback),
}));

const ORIGIN = "http://demo.local";

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

async function installWire() {
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

type RunReport = {
  messages: Array<{ seq: number; from: string; type: string; arrivalMs: number; turnMs: number; callMs: number; outTokens: number; windows: string; note: string }>;
  ackMs: number;
  agreedMs: number;
  stateAtEnd: string;
  replayed: number;
  leaks: string[];
};

async function runOnce(store: JsonStore, label: string): Promise<RunReport> {
  const started = Date.now();
  const arrivals: number[] = [];
  const append = store.appendMessage.bind(store);
  store.appendMessage = async (record) => {
    const before = (await store.listMessages()).length;
    await append(record);
    if ((await store.listMessages()).length > before) arrivals.push(Date.now() - started);
  };

  // 1. The reel arrives.
  const { POST: postSignal } = await import("@/app/api/signals/route");
  const ackStarted = Date.now();
  const ack = await postSignal(new Request(`${ORIGIN}/api/signals`, { method: "POST", body: "{}" }));
  const ackMs = Date.now() - ackStarted;
  expect(ack.status).toBe(202);
  const { contextId, planId } = (await ack.json()) as { contextId: string; planId: string };

  // 2. The agents talk: run each queued turn, which may queue the next one.
  while (queued.length > 0) await queued.shift()!();

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
  expect((await store.listEvents()).filter((event) => event.kind === "followed_through")).toHaveLength(1);

  // 4. The privacy toggle: Sprout stops sharing location with Mochi; the sent messages replay under it.
  const toggled = await setSharePolicy(store, { owner: "aaron", friend: "lisa", categories: { location: false } });
  expect(toggled.ok).toBe(true);
  const replayed = toggled.ok ? toggled.value.replayed.length : 0;

  // 5. Nothing private crossed the wire.
  const delivered = JSON.stringify((await store.listMessages(contextId)).map((record) => record.message));
  const leaks = Object.values(PRIVATE_STRINGS).flat().filter((secret) => delivered.toLowerCase().includes(secret.toLowerCase()));
  expect(leaks, `${label}: private strings delivered`).toEqual([]);

  const rows = records.map((record, index) => ({
    seq: record.message.seq,
    from: record.message.from === "aaron" ? "Sprout" : "Mochi",
    type: record.message.type,
    arrivalMs: arrivals[index] ?? 0,
    turnMs: (arrivals[index] ?? 0) - (arrivals[index - 1] ?? 0),
    callMs: record.proof?.latencyMs ?? 0,
    outTokens: record.proof?.outputTokens ?? 0,
    windows: (record.message.windows ?? []).map(describeWindow).join(", "),
    note: record.message.note ?? "",
  }));
  return { messages: rows, ackMs, agreedMs, stateAtEnd: final.state, replayed, leaks };
}

function printReport(label: string, report: RunReport) {
  const lines = [
    `DEMO ${label}: signal acknowledged in ${report.ackMs}ms; agents agreed in ${report.messages.length} messages at ${seconds(report.agreedMs)}; plan ended ${report.stateAtEnd}; privacy replay changed ${report.replayed} message(s); private strings delivered: ${report.leaks.length}`,
    "  #  from    type    arrival  turn    send call  out tok  windows / note",
    ...report.messages.map(
      (row) =>
        `  ${row.seq}  ${row.from.padEnd(6)}  ${row.type.padEnd(6)}  ${seconds(row.arrivalMs).padStart(7)}  ${seconds(row.turnMs).padStart(6)}  ${seconds(row.callMs).padStart(9)}  ${String(row.outTokens).padStart(7)}  ${row.windows}${row.note ? ` | "${row.note}"` : ""}`,
    ),
  ];
  console.log(lines.join("\n"));
}

it("runs the shawarma scenario from the reel to the follow-up, on live Muse Spark", async () => {
  const runs = Number(process.env.DEMO_RUNS ?? 1);
  const uninstall = await installWire();
  const store = new JsonStore(null);
  (globalThis as { __museStore?: Promise<JsonStore> }).__museStore = Promise.resolve(store);
  try {
    const reports: RunReport[] = [];
    for (let run = 1; run <= runs; run += 1) {
      if (run > 1) await resetDemo(store);
      const report = await runOnce(store, `run ${run}/${runs}`);
      printReport(`run ${run}/${runs}`, report);
      reports.push(report);
    }
    const agreed = reports.map((report) => report.agreedMs).sort((a, b) => a - b);
    console.log(`DEMO SUMMARY: ${runs} run(s) passed; time to agreement median ${seconds(agreed[Math.floor(agreed.length / 2)])} (min ${seconds(agreed[0])}, max ${seconds(agreed.at(-1)!)}); messages ${reports.map((report) => report.messages.length).join(", ")}`);
    if (process.env.DEMO_RECORD) {
      const run = await recordCurrentRun(store, { id: "run_shawarma_live", label: "Shawarma thread (live run)" });
      writeFileSync(process.env.DEMO_RECORD, JSON.stringify(run, null, 2));
      console.log(`DEMO recorded the last run to ${process.env.DEMO_RECORD}`);
    }
  } finally {
    uninstall();
    (globalThis as { __museStore?: unknown }).__museStore = undefined;
  }
}, 600_000);
