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
    expect(await response.json()).toEqual({ ok: true, sha: "3a755f3" });
  });

  it("reports local when no commit sha is set", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
    const body = await GET().json();
    expect(body).toEqual({ ok: true, sha: "local" });
  });
});
