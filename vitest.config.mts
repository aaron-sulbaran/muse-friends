import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // Resolves the "@/*" alias from tsconfig.json.
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    setupFiles: ["./tests/helpers/no-404-tail.ts"],
    // Lane worktrees live under .claude/worktrees; never run their tests from the main checkout.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
