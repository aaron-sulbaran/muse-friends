import { defineConfig } from "vitest/config";

// Live smoke tests against the Meta Model API (TECH_SPEC "Testing", smoke tests 1 to 3).
// Run: pnpm exec vitest run --config vitest.live.config.mts
// Needs MODEL_API_KEY in .env; spends a few cents of credits.
try {
  process.loadEnvFile(".env");
} catch {
  // No .env file; MODEL_API_KEY may already be in the environment.
}

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["tests/live/**/*.live.ts"],
    exclude: [".claude/**", "node_modules/**"],
    testTimeout: 300_000,
    fileParallelism: false,
  },
});
