import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

// The bookkeeping of `pnpm evals`: one result per run, one summary per scenario, a console table, and a JSON
// report. Nothing here talks to a model, so the helpers are unit tested in the normal suite.

export type RunResult = {
  pass: boolean;
  // Every invariant that did not hold in this run, in words.
  failures: string[];
  // Wall clock for the whole run.
  ms: number;
  // Negotiation messages in the run (null when the scenario has none).
  messages: number | null;
  // Anything worth keeping next to the numbers: windows dropped, payment amount, who answered.
  detail: Record<string, unknown>;
};

export type ScenarioSummary = {
  id: string;
  name: string;
  invariants: string;
  runs: number;
  passes: number;
  medianMs: number;
  medianMessages: number | null;
  failures: string[];
  details: Array<Record<string, unknown>>;
};

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

// Collects what held and what did not for one run, without stopping at the first miss.
export class Checks {
  readonly failures: string[] = [];
  readonly detail: Record<string, unknown> = {};

  that(ok: boolean, label: string): boolean {
    if (!ok) this.failures.push(label);
    return ok;
  }

  note(key: string, value: unknown): void {
    this.detail[key] = value;
  }

  result(ms: number, messages: number | null): RunResult {
    return { pass: this.failures.length === 0, failures: [...this.failures], ms, messages, detail: this.detail };
  }
}

export function summarize(meta: { id: string; name: string; invariants: string }, results: RunResult[]): ScenarioSummary {
  const counted = results.flatMap((result) => (result.messages === null ? [] : [result.messages]));
  return {
    ...meta,
    runs: results.length,
    passes: results.filter((result) => result.pass).length,
    medianMs: median(results.map((result) => result.ms)),
    medianMessages: counted.length > 0 ? median(counted) : null,
    failures: results.flatMap((result, index) => result.failures.map((failure) => `run ${index + 1}: ${failure}`)),
    details: results.map((result) => result.detail),
  };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

// One table for the whole suite: a row per scenario, then the failures under it.
export function formatTable(summaries: ScenarioSummary[]): string {
  const rows = summaries.map((summary) => [
    summary.id,
    summary.name,
    String(summary.runs),
    `${summary.passes}/${summary.runs}`,
    seconds(summary.medianMs),
    summary.medianMessages === null ? "-" : String(summary.medianMessages),
  ]);
  const header = ["#", "scenario", "runs", "passes", "median time", "median messages"];
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column].length)));
  const line = (cells: string[]) => cells.map((cell, column) => cell.padEnd(widths[column])).join("  ");
  const out = [line(header), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)];
  for (const summary of summaries) {
    if (summary.failures.length === 0) continue;
    out.push("", `${summary.id} ${summary.name}: ${summary.passes}/${summary.runs} passed`, ...summary.failures.map((failure) => `  - ${failure}`));
  }
  return out.join("\n");
}

export type Report = { startedAt: string; runsPerScenario: number; model: string; scenarios: ScenarioSummary[] };

// Writes .evals/report-<time>.json and .evals/latest.json (the directory is gitignored).
export function writeReport(report: Report, directory = ".evals"): { file: string; latest: string } {
  mkdirSync(directory, { recursive: true });
  const stamp = report.startedAt.replace(/[:.]/g, "-");
  const file = path.join(directory, `report-${stamp}.json`);
  const latest = path.join(directory, "latest.json");
  const body = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(file, body);
  writeFileSync(latest, body);
  return { file, latest };
}
