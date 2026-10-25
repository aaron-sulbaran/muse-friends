import { defineConfig } from "vitest/config";

// Behavior evals against live Muse Spark (tests/evals/). Run with `pnpm evals`; see docs/RUNBOOK.md "Evals".
// Needs MODEL_API_KEY in .env and RUN_EVALS=1 (the pnpm script sets it); otherwise every scenario is skipped.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file; MODEL_API_KEY may already be in the environment.
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/evals/**/*.eval.ts"],
    exclude: [".claude/**", "node_modules/**"],
    testTimeout: 3_600_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
