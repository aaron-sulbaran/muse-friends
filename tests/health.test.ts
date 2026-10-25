import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/health/route";

describe("GET /api/health", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports ok with the short commit sha on Vercel", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "3a755f3abcdef0123456789");
    const response = GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, sha: "3a755f3", model: "muse-spark-1.3", fallbackModels: ["muse-spark-1.2"] });
  });

  it("reports local when no commit sha is set", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    const body = await GET().json();
    expect(body).toEqual({ ok: true, sha: "local", model: "muse-spark-1.3", fallbackModels: ["muse-spark-1.2"] });
  });

  it("reports the configured model and the fallback list, which an env can change or empty", async () => {
    vi.stubEnv("MODEL_ID", "muse-spark-1.2");
    expect(await GET().json()).toMatchObject({ model: "muse-spark-1.2", fallbackModels: [] });
    vi.stubEnv("MODEL_ID", "muse-spark-1.3");
    vi.stubEnv("MODEL_FALLBACK_IDS", "muse-spark-1.2, muse-spark-1.1");
    expect(await GET().json()).toMatchObject({ model: "muse-spark-1.3", fallbackModels: ["muse-spark-1.2", "muse-spark-1.1"] });
    vi.stubEnv("MODEL_FALLBACK_IDS", "");
    expect(await GET().json()).toMatchObject({ fallbackModels: [] });
  });
});
