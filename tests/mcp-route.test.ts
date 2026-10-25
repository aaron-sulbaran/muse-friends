import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/mcp/route";

const tokenA = "a".repeat(48);
const tokenB = "b".repeat(48);

function rpc(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("https://muse-friends.test/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

// The handler answers over server-sent events; the JSON-RPC message is on the data line.
async function readRpcResult(response: Response) {
  const text = await response.text();
  const dataLine = text.split("\n").find((line) => line.startsWith("data: "));
  return JSON.parse(dataLine!.slice("data: ".length));
}

describe("POST /api/mcp", () => {
  const shared = globalThis as typeof globalThis & { __museStore?: unknown };

  beforeEach(() => {
    vi.stubEnv("MCP_TOKEN_A", tokenA);
    vi.stubEnv("MCP_TOKEN_B", tokenB);
    // The tool reads whatever store getStore() returns; keep it the local JSON store in a temp file
    // so no test can reach the production store or the demo room.
    vi.stubEnv("STORE", "json");
    vi.stubEnv("STORE_PATH", path.join(mkdtempSync(path.join(tmpdir(), "muse-mcp-")), "store.json"));
    delete shared.__museStore;
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    delete shared.__museStore;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const callGetStatus = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_status", arguments: {} } };

  it("rejects a request with no credential", async () => {
    const response = await rpc(callGetStatus);
    expect(response.status).toBe(401);
  });

  it("rejects a wrong token", async () => {
    const response = await rpc(callGetStatus, { authorization: `Bearer ${"c".repeat(48)}` });
    expect(response.status).toBe(401);
  });

  it("rejects everything when the token variables are unset", async () => {
    vi.stubEnv("MCP_TOKEN_A", "");
    vi.stubEnv("MCP_TOKEN_B", "");
    const response = await rpc(callGetStatus, { authorization: "Bearer " });
    expect(response.status).toBe(401);
  });

  it("answers get_status for account B with a bearer token", async () => {
    const response = await rpc(callGetStatus, { authorization: `Bearer ${tokenB}` });
    expect(response.status).toBe(200);
    const message = await readRpcResult(response);
    const status = JSON.parse(message.result.content[0].text);
    expect(status).toMatchObject({ ok: true, service: "muse-friends", account: "b" });
    expect(status.store).toEqual({ kind: "json", threads: 0, messages: 0, plans: 0, cards: 0, events: 0 });
  });

  it("accepts the token in x-api-key too", async () => {
    const response = await rpc(callGetStatus, { "x-api-key": tokenA });
    expect(response.status).toBe(200);
    const status = JSON.parse((await readRpcResult(response)).result.content[0].text);
    expect(status.account).toBe("a");
  });

  it("never writes a key into the logs", async () => {
    await rpc(callGetStatus, { authorization: `Bearer ${tokenA}` });
    await rpc(callGetStatus, { authorization: `Bearer ${"c".repeat(48)}` });
    const logged = JSON.stringify(vi.mocked(console.log).mock.calls);
    expect(logged).not.toContain(tokenA);
    expect(logged).not.toContain("c".repeat(48));
    expect(logged).toContain("accepted=true");
    expect(logged).toContain("accepted=false");
  });

  it("lists get_status and the three judge tools, and nothing else", async () => {
    const response = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { authorization: `Bearer ${tokenA}` });
    const message = await readRpcResult(response);
    expect(message.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(["check_plan", "get_status", "respond", "start_plan"]);
  });
});
