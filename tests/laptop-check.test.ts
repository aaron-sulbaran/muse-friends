import { describe, expect, it } from "vitest";
import {
  checkCron,
  checkInstagram,
  checkMcp,
  checkNessie,
  checkRooms,
  checkSha,
  formatResult,
  parseArgs,
  parseEnvFile,
  redact,
  runLaptopCheck,
  secretsIn,
  summarize,
  vercelProductionNames,
} from "../scripts/laptop-check.mjs";

const BASE = "https://www.musefriends.test";

type Reply = { status: number; body?: unknown };
type Call = { url: string; method: string; authorization: string | undefined };

// A fake app and a fake Nessie: URL (without the query) to a reply. Every call is recorded so tests can check
// that nothing but a GET ever went out.
function fakeFetch(routes: Record<string, Reply | ((headers: Record<string, string>) => Reply)>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: { method?: string; headers?: Record<string, string> } = {}) => {
    const headers = init.headers ?? {};
    calls.push({ url, method: init.method ?? "GET", authorization: headers.authorization });
    const path = url.split("?")[0];
    const route = routes[path];
    if (!route) return new Response("not found", { status: 404 });
    const reply = typeof route === "function" ? route(headers) : route;
    return new Response(reply.body === undefined ? "" : JSON.stringify(reply.body), { status: reply.status });
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const TOKEN_A = "a-token-0123456789abcdef0123456789";
const TOKEN_B = "b-token-0123456789abcdef0123456789";
const JUDGE = "j-token-0123456789abcdef0123456789";
const NESSIE = "nessie-key-0123456789abcdef";
const CRON = "cron-secret-0123456789abcdef";

const statusFor = (accepted: Record<string, string>) => (headers: Record<string, string>): Reply => {
  const token = headers.authorization?.replace("Bearer ", "");
  const account = Object.entries(accepted).find(([, value]) => value === token)?.[0];
  return account ? { status: 200, body: { data: { ok: true, account }, error: null } } : { status: 401, body: { data: null, error: { message: "A valid key is required" } } };
};

describe("parseArgs", () => {
  it("defaults to production and .env, and normalises the base", () => {
    expect(parseArgs([])).toMatchObject({ base: "https://www.musefriends.tech", expectSha: null, envFile: ".env", error: null });
    expect(parseArgs(["--base", "https://x.test///"]).base).toBe("https://x.test");
  });

  it("takes --expect-sha and --env-file, lowercases the sha, and flags bad input", () => {
    expect(parseArgs(["--expect-sha", "43D3BAB", "--env-file", "/tmp/e"])).toMatchObject({ expectSha: "43d3bab", envFile: "/tmp/e", error: null });
    expect(parseArgs(["--base", "musefriends.tech"]).error).toContain("--base");
    expect(parseArgs(["--expect-sha", "zz"]).error).toContain("--expect-sha");
    expect(parseArgs(["--nope"]).error).toContain("unknown option");
    expect(parseArgs(["--help"]).help).toBe(true);
  });
});

describe("parseEnvFile", () => {
  it("reads KEY=value lines, strips quotes, ignores comments and blanks", () => {
    const env = parseEnvFile(`# comment\n\nNESSIE_KEY=abc123\nMCP_TOKEN_A="quoted-value"\nexport MCP_TOKEN_B='single'\nBAD LINE\nEMPTY=\nWITH_EQUALS=a=b=c\n`);
    expect(env).toEqual({ NESSIE_KEY: "abc123", MCP_TOKEN_A: "quoted-value", MCP_TOKEN_B: "single", EMPTY: "", WITH_EQUALS: "a=b=c" });
  });

  it("finds the names that look like secrets for scrubbing", () => {
    expect(secretsIn({ NESSIE_KEY: "k1", MCP_TOKEN_A: "t1", CRON_SECRET: "s1", STORE: "supabase", SUPABASE_URL: "https://x" })).toEqual(["k1", "t1", "s1"]);
  });
});

describe("step 1, nessie", () => {
  const sandbox = { "https://api.nessieisreal.com/accounts": { status: 200, body: [{ _id: "1" }, { _id: "2" }] } };

  it("PASS when the variable is in Vercel and the sandbox lists accounts for the key, and only reads", async () => {
    const { fetchImpl, calls } = fakeFetch(sandbox);
    const verdict = await checkNessie({ key: NESSIE, vercelNames: new Set(["NESSIE_KEY"]), fetchImpl });
    expect(verdict).toMatchObject({ verdict: "PASS", step: 1 });
    expect(verdict.detail).toContain("2 accounts");
    expect(calls).toHaveLength(1);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(calls[0].url).toContain("/accounts?key=");
  });

  it("FAIL when the variable is not in Vercel production, without calling the sandbox", async () => {
    const { fetchImpl, calls } = fakeFetch(sandbox);
    const verdict = await checkNessie({ key: NESSIE, vercelNames: new Set(["MODEL_API_KEY"]), fetchImpl });
    expect(verdict.verdict).toBe("FAIL");
    expect(verdict.detail).toContain("step 1.4");
    expect(calls).toHaveLength(0);
  });

  it("FAIL when the sandbox rejects the key, and when it does not answer", async () => {
    const rejected = await checkNessie({ key: NESSIE, vercelNames: new Set(["NESSIE_KEY"]), fetchImpl: fakeFetch({ "https://api.nessieisreal.com/accounts": { status: 401 } }).fetchImpl });
    expect(rejected.verdict).toBe("FAIL");
    expect(rejected.detail).toContain("rejected");
    const silent = await checkNessie({ key: NESSIE, vercelNames: new Set(["NESSIE_KEY"]), fetchImpl: async () => Promise.reject(new Error("offline")) });
    expect(silent.verdict).toBe("FAIL");
    expect(silent.detail).toContain("no answer");
  });

  it("SKIP when the key is in Vercel but not in .env, and when nothing could be checked", async () => {
    const { fetchImpl } = fakeFetch(sandbox);
    expect((await checkNessie({ key: null, vercelNames: new Set(["NESSIE_KEY"]), fetchImpl })).verdict).toBe("SKIP");
    const unknown = await checkNessie({ key: null, vercelNames: null, fetchImpl });
    expect(unknown.verdict).toBe("SKIP");
    const keyOnly = await checkNessie({ key: NESSIE, vercelNames: null, fetchImpl });
    expect(keyOnly.verdict).toBe("SKIP");
    expect(keyOnly.detail).toContain("2 accounts");
  });
});

describe("step 2, instagram", () => {
  it("PASS when /api/state carries the real reel", () => {
    const verdict = checkInstagram({ state: { status: 200, json: { reel: { username: "lisa_demo", caption: "private words" }, messages: [] } }, vercelNames: null });
    expect(verdict).toMatchObject({ verdict: "PASS" });
    expect(verdict.detail).toContain("@lisa_demo");
    expect(verdict.detail).not.toContain("private words");
  });

  it("SKIP with 'seeded reel in use' otherwise, and says why when it can", () => {
    const seeded = { status: 200, json: { reel: null, messages: [] } };
    expect(checkInstagram({ state: seeded, vercelNames: null })).toMatchObject({ verdict: "SKIP", detail: "seeded reel in use" });
    expect(checkInstagram({ state: seeded, vercelNames: new Set(["INSTAGRAM_ACCESS_TOKEN"]) }).detail).toContain("redeploy");
    expect(checkInstagram({ state: seeded, vercelNames: new Set() }).detail).toContain("step 2.3");
    expect(checkInstagram({ state: { status: 200, json: { reel: null, messages: [{}] } }, vercelNames: null }).detail).toContain("holds a run");
  });

  it("FAIL when /api/state does not answer", () => {
    expect(checkInstagram({ state: { status: 500, json: null }, vercelNames: null }).verdict).toBe("FAIL");
    expect(checkInstagram({ state: { status: 0, json: null }, vercelNames: null }).verdict).toBe("FAIL");
  });
});

describe("step 3, cron", () => {
  it("PASS on 401, FAIL on 503, 200, no answer, or anything else", () => {
    expect(checkCron({ response: { status: 401 } }).verdict).toBe("PASS");
    const unset = checkCron({ response: { status: 503 } });
    expect(unset.verdict).toBe("FAIL");
    expect(unset.detail).toContain("not set");
    expect(checkCron({ response: { status: 200 } }).verdict).toBe("FAIL");
    expect(checkCron({ response: { status: 0 } }).verdict).toBe("FAIL");
    expect(checkCron({ response: { status: 500 } }).detail).toContain("500");
  });
});

describe("step 4, mcp tokens", () => {
  const closedWithoutKey = { status: 401 } as Reply;

  it("PASS when no key is refused and each key in .env gets get_status", async () => {
    const accepted = { a: TOKEN_A, b: TOKEN_B };
    const { fetchImpl, calls } = fakeFetch({ [`${BASE}/api/connector/status`]: (headers) => (headers.authorization ? statusFor(accepted)(headers) : closedWithoutKey) });
    const verdict = await checkMcp({ tokens: { a: TOKEN_A, b: TOKEN_B }, fetchImpl, base: BASE });
    expect(verdict).toMatchObject({ verdict: "PASS" });
    expect(verdict.detail).toContain("account a and account b");
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(calls.map((call) => call.url)).toEqual(Array(3).fill(`${BASE}/api/connector/status`));
  });

  it("checks only the keys that are in .env", async () => {
    const { fetchImpl } = fakeFetch({ [`${BASE}/api/connector/status`]: (headers) => (headers.authorization ? statusFor({ a: TOKEN_A })(headers) : closedWithoutKey) });
    const verdict = await checkMcp({ tokens: { a: TOKEN_A, b: "" }, fetchImpl, base: BASE });
    expect(verdict.verdict).toBe("PASS");
    expect(verdict.detail).toContain("account a");
    expect(verdict.detail).not.toContain("account b");
  });

  it("SKIP when neither key is in .env", async () => {
    const { fetchImpl, calls } = fakeFetch({});
    expect((await checkMcp({ tokens: { a: "", b: "" }, fetchImpl, base: BASE })).verdict).toBe("SKIP");
    expect(calls).toHaveLength(0);
  });

  it("FAIL when the deployment rejects the key, answers without a key, or answers wrongly", async () => {
    const wrong = fakeFetch({ [`${BASE}/api/connector/status`]: (headers) => (headers.authorization ? { status: 401 } : { status: 401 }) });
    const rejected = await checkMcp({ tokens: { a: TOKEN_A, b: "" }, fetchImpl: wrong.fetchImpl, base: BASE });
    expect(rejected.verdict).toBe("FAIL");
    expect(rejected.detail).toContain("MCP_TOKEN_A");
    const open = fakeFetch({ [`${BASE}/api/connector/status`]: { status: 200, body: { data: { ok: true }, error: null } } });
    expect((await checkMcp({ tokens: { a: TOKEN_A, b: "" }, fetchImpl: open.fetchImpl, base: BASE })).detail).toContain("no key");
    const broken = fakeFetch({ [`${BASE}/api/connector/status`]: (headers) => (headers.authorization ? { status: 200, body: { data: { ok: false } } } : { status: 401 }) });
    expect((await checkMcp({ tokens: { a: TOKEN_A, b: "" }, fetchImpl: broken.fetchImpl, base: BASE })).verdict).toBe("FAIL");
  });
});

describe("step 5, the byom_rooms table", () => {
  const probe = `${BASE}/api/connector/check_plan`;

  it("PASS on a clean 404 from the table, reading with a GET and creating nothing", async () => {
    const { fetchImpl, calls } = fakeFetch({ [probe]: { status: 404, body: { data: null, error: { code: "no_such_plan" } } } });
    const verdict = await checkRooms({ judgeKey: JUDGE, fetchImpl, base: BASE });
    expect(verdict.verdict).toBe("PASS");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "GET", authorization: `Bearer ${JUDGE}` });
    expect(calls[0].url).toBe(`${probe}?planId=room_laptop_check_probe`);
  });

  it("FAIL on 503 (table missing), with the checklist step to do", async () => {
    const { fetchImpl } = fakeFetch({ [probe]: { status: 503, body: { data: null, error: { code: "rooms_unavailable" } } } });
    const verdict = await checkRooms({ judgeKey: JUDGE, fetchImpl, base: BASE });
    expect(verdict.verdict).toBe("FAIL");
    expect(verdict.detail).toContain("step 4");
  });

  it("SKIP on 401 (the station is closed on the deployment) and with no judge key in .env", async () => {
    const closed = await checkRooms({ judgeKey: JUDGE, fetchImpl: fakeFetch({ [probe]: { status: 401 } }).fetchImpl, base: BASE });
    expect(closed.verdict).toBe("SKIP");
    expect(closed.detail).toContain("closed");
    const { fetchImpl, calls } = fakeFetch({});
    expect((await checkRooms({ judgeKey: null, fetchImpl, base: BASE })).verdict).toBe("SKIP");
    expect(calls).toHaveLength(0);
  });

  it("FAIL on a team-key refusal or anything unexpected", async () => {
    expect((await checkRooms({ judgeKey: JUDGE, fetchImpl: fakeFetch({ [probe]: { status: 403 } }).fetchImpl, base: BASE })).verdict).toBe("FAIL");
    expect((await checkRooms({ judgeKey: JUDGE, fetchImpl: fakeFetch({ [probe]: { status: 500 } }).fetchImpl, base: BASE })).verdict).toBe("FAIL");
    expect((await checkRooms({ judgeKey: JUDGE, fetchImpl: fakeFetch({ [probe]: { status: 404, body: { error: { code: "something_else" } } } }).fetchImpl, base: BASE })).verdict).toBe("FAIL");
  });
});

describe("step 6, the deployed sha", () => {
  const health = (sha: string) => ({ status: 200, json: { ok: true, sha } });

  it("PASS when it matches, in either direction of abbreviation, and informational without --expect-sha", () => {
    expect(checkSha({ health: health("43d3babcdef0123"), expectSha: "43d3bab" }).verdict).toBe("PASS");
    expect(checkSha({ health: health("43d3bab"), expectSha: "43d3babcdef" }).verdict).toBe("PASS");
    const info = checkSha({ health: health("43d3bab"), expectSha: null });
    expect(info.verdict).toBe("PASS");
    expect(info.detail).toContain("43d3bab");
  });

  it("FAIL on a different commit, and when health does not answer", () => {
    const wrong = checkSha({ health: health("9d5d9b4"), expectSha: "43d3bab" });
    expect(wrong.verdict).toBe("FAIL");
    expect(wrong.detail).toContain("has not landed");
    expect(checkSha({ health: { status: 500, json: null }, expectSha: null }).verdict).toBe("FAIL");
    expect(checkSha({ health: { status: 200, json: { ok: true } }, expectSha: null }).verdict).toBe("FAIL");
  });
});

describe("the verdict lines and the total", () => {
  it("print one aligned line per step, scrub every secret, and total the verdicts", () => {
    const line = formatResult({ step: 4, name: "mcp", verdict: "PASS", detail: `token ${TOKEN_A} accepted` }, [TOKEN_A]);
    expect(line).toBe("  PASS  4 mcp       token [redacted] accepted");
    expect(redact(`a ${NESSIE} b`, [NESSIE])).toBe("a [redacted] b");
    expect(redact("short", ["abc"])).toBe("short");
    const summary = summarize([{ verdict: "PASS" }, { verdict: "SKIP" }, { verdict: "SKIP" }] as never);
    expect(summary).toEqual({ line: "LAPTOP CHECK: 1 PASS, 0 FAIL, 2 SKIP", exitCode: 0 });
    expect(summarize([{ verdict: "FAIL" }, { verdict: "PASS" }] as never)).toEqual({ line: "LAPTOP CHECK: 1 PASS, 1 FAIL, 0 SKIP", exitCode: 1 });
  });
});

describe("vercelProductionNames", () => {
  const runner = (stdout: string, error: Error | null = null) => ((_cmd: string, _args: string[], _opts: object, done: (error: Error | null, out: string) => void) => done(error, stdout)) as never;

  it("returns only the names configured for production, never a value, and calls the CLI without a shell", async () => {
    const calls: string[][] = [];
    const run = ((cmd: string, args: string[], _opts: object, done: (error: Error | null, out: string) => void) => {
      calls.push([cmd, ...args]);
      done(null, JSON.stringify({ envs: [{ key: "NESSIE_KEY", target: ["production", "preview"], value: "super-secret" }, { key: "PREVIEW_ONLY", target: ["preview"] }, { key: "CRON_SECRET", target: ["production"] }] }));
    }) as never;
    const names = await vercelProductionNames({ run });
    expect([...names!].sort()).toEqual(["CRON_SECRET", "NESSIE_KEY"]);
    expect(JSON.stringify([...names!])).not.toContain("super-secret");
    expect(calls[0].slice(0, 3)).toEqual(["vercel", "api", "/v10/projects/muse-friends/env"]);
  });

  it("returns null when the CLI fails or answers something unreadable", async () => {
    expect(await vercelProductionNames({ run: runner("", new Error("not logged in")) })).toBeNull();
    expect(await vercelProductionNames({ run: runner("not json") })).toBeNull();
    expect(await vercelProductionNames({ run: runner(JSON.stringify({ nope: true })) })).toBeNull();
  });
});

describe("the whole run", () => {
  const sandbox = { "https://api.nessieisreal.com/accounts": { status: 200, body: [{ _id: "1" }] } };

  function app(overrides: Record<string, Reply | ((headers: Record<string, string>) => Reply)> = {}) {
    return fakeFetch({
      [`${BASE}/api/health`]: { status: 200, body: { ok: true, sha: "43d3bab" } },
      [`${BASE}/api/state`]: { status: 200, body: { reel: { username: "lisa_demo" }, messages: [] } },
      [`${BASE}/api/cron/sweep`]: { status: 401 },
      [`${BASE}/api/connector/status`]: (headers) => (headers.authorization ? statusFor({ a: TOKEN_A, b: TOKEN_B })(headers) : { status: 401 }),
      [`${BASE}/api/connector/check_plan`]: { status: 404, body: { error: { code: "no_such_plan" } } },
      ...sandbox,
      ...overrides,
    });
  }
  const env = { NESSIE_KEY: NESSIE, MCP_TOKEN_A: TOKEN_A, MCP_TOKEN_B: TOKEN_B, MCP_TOKEN_JUDGE: JUDGE, CRON_SECRET: CRON };

  it("passes every step when everything is done, with only GET requests and no secret in any line", async () => {
    const { fetchImpl, calls } = app();
    const results = await runLaptopCheck({ base: BASE, expectSha: "43d3bab", env, fetchImpl, vercelNames: new Set(["NESSIE_KEY"]) });
    expect(results.map((item) => `${item.step}:${item.verdict}`)).toEqual(["1:PASS", "2:PASS", "3:PASS", "4:PASS", "5:PASS", "6:PASS"]);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    // The sweep is only ever asked without its secret, so it can never run.
    expect(calls.filter((call) => call.url.endsWith("/api/cron/sweep")).every((call) => call.authorization === undefined)).toBe(true);
    const printed = results.map((item) => formatResult(item, secretsIn(env))).join("\n");
    for (const secret of Object.values(env)) expect(printed).not.toContain(secret);
    expect(summarize(results).exitCode).toBe(0);
  });

  it("before any of the laptop steps: FAIL on what is missing, SKIP on what cannot be tested, exit 1", async () => {
    const { fetchImpl } = app({
      [`${BASE}/api/state`]: { status: 200, body: { reel: null, messages: [] } },
      [`${BASE}/api/cron/sweep`]: { status: 503 },
      [`${BASE}/api/connector/status`]: { status: 401 },
      [`${BASE}/api/connector/check_plan`]: { status: 401 },
    });
    const results = await runLaptopCheck({ base: BASE, expectSha: null, env: {}, fetchImpl, vercelNames: new Set(["MODEL_API_KEY", "STORE"]) });
    expect(results.map((item) => `${item.step}:${item.verdict}`)).toEqual(["1:FAIL", "2:SKIP", "3:FAIL", "4:SKIP", "5:SKIP", "6:PASS"]);
    expect(results[1].detail).toContain("seeded reel in use");
    const summary = summarize(results);
    expect(summary.line).toBe("LAPTOP CHECK: 1 PASS, 2 FAIL, 3 SKIP");
    expect(summary.exitCode).toBe(1);
  });

  it("makes no write request of any kind, and the script source contains no POST, PUT, PATCH or DELETE", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("../scripts/laptop-check.mjs", import.meta.url), "utf8");
    expect(source).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/i);
    expect(source).not.toContain("em dash");
    expect(source).not.toContain("\u2014");
  });
});
