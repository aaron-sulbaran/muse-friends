import { describe, expect, it } from "vitest";
import { readPresentedCredential, resolveMcpAccount } from "@/app/api/mcp/_lib/auth";

const tokenA = "a".repeat(48);
const tokenB = "b".repeat(48);
const env = { MCP_TOKEN_A: tokenA, MCP_TOKEN_B: tokenB };

describe("resolveMcpAccount", () => {
  it("maps each token to its own account", () => {
    expect(resolveMcpAccount(tokenA, env)).toBe("a");
    expect(resolveMcpAccount(tokenB, env)).toBe("b");
  });

  it("rejects an unknown, empty, or missing token", () => {
    expect(resolveMcpAccount("c".repeat(48), env)).toBeNull();
    expect(resolveMcpAccount("", env)).toBeNull();
    expect(resolveMcpAccount(undefined, env)).toBeNull();
  });

  it("rejects a prefix or an extension of a real token", () => {
    expect(resolveMcpAccount(tokenA.slice(0, 47), env)).toBeNull();
    expect(resolveMcpAccount(`${tokenA}x`, env)).toBeNull();
  });

  it("fails closed when the environment variables are unset or too short", () => {
    expect(resolveMcpAccount(tokenA, {})).toBeNull();
    expect(resolveMcpAccount("short", { MCP_TOKEN_A: "short" })).toBeNull();
    expect(resolveMcpAccount("", { MCP_TOKEN_A: "" })).toBeNull();
  });
});

describe("readPresentedCredential", () => {
  const request = (headers: Record<string, string>) => new Request("https://example.test/api/mcp", { headers });

  it("prefers the bearer token", () => {
    expect(readPresentedCredential(request({ "x-api-key": "from-header" }), "from-bearer")).toEqual({
      token: "from-bearer",
      scheme: "bearer",
    });
  });

  it("falls back to x-api-key", () => {
    expect(readPresentedCredential(request({ "x-api-key": "from-header" }), undefined)).toEqual({
      token: "from-header",
      scheme: "x-api-key",
    });
  });

  it("reports none when nothing is presented", () => {
    expect(readPresentedCredential(request({}), undefined)).toEqual({ token: undefined, scheme: "none" });
  });
});
