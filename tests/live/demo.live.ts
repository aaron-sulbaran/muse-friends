import { it, vi } from "vitest";
import { JsonStore } from "@/lib/store/json";
import { installWire, printReport, resetBetweenRuns, runScenario, seconds, type ScenarioReport } from "./helpers/scenario";

// The scripted demo: the shawarma scenario from the reel to the next-day follow-up on live Muse Spark.
//
//   pnpm demo:run                 one run
//   DEMO_RUNS=2 pnpm demo:run     the C3 "passes twice" check
//
// What it exercises for real: the Responses loop on Muse Spark for both agents, the signals route, the
// bearer-authenticated inbox route (a fetch shim hands each POST to the route handler, so tokens,
// validation, and the 202-then-turn flow all run), the send checks, the share policy, cards, human
// decisions, handoff, hold, the demo clock, and the privacy replay. What it does not: a real network
// hop or the Vercel runtime, so `after()` callbacks are queued and run one at a time here.
// `pnpm demo:record` runs the same scenario and saves the best run for Replay.

vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (await import("./helpers/scenario")).mockAfter,
}));

it("runs the shawarma scenario from the reel to the follow-up, on live Muse Spark", async () => {
  const runs = Number(process.env.DEMO_RUNS ?? 1);
  const uninstall = installWire();
  const store = new JsonStore(null);
  (globalThis as { __museStore?: Promise<JsonStore> }).__museStore = Promise.resolve(store);
  try {
    const reports: ScenarioReport[] = [];
    for (let run = 1; run <= runs; run += 1) {
      if (run > 1) await resetBetweenRuns(store);
      const report = await runScenario(store, `run ${run}/${runs}`);
      printReport(`run ${run}/${runs}`, report);
      reports.push(report);
    }
    const agreed = reports.map((report) => report.agreedMs).sort((a, b) => a - b);
    console.log(
      `DEMO SUMMARY: ${runs} run(s) passed; time to agreement median ${seconds(agreed[Math.floor(agreed.length / 2)])} (min ${seconds(agreed[0])}, max ${seconds(agreed.at(-1)!)}); messages ${reports.map((report) => report.rows.length).join(", ")}`,
    );
  } finally {
    uninstall();
    (globalThis as { __museStore?: unknown }).__museStore = undefined;
  }
}, 600_000);
