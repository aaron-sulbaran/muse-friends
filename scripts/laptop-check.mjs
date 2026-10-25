#!/usr/bin/env node
// Verifies each of Aaron's manual laptop steps (kb/laptop-checklist.md) the moment it lands, against the live app.
//
//   pnpm laptop:check --base https://www.musefriends.tech
//   pnpm laptop:check --base https://www.musefriends.tech --expect-sha 43d3bab
//
// Options: --base URL         the deployed app (default https://www.musefriends.tech; use the www address)
//          --expect-sha SHA   the deployed commit must start with SHA (step 6)
//          --env-file PATH    where the local keys are read from (default .env)
//
// One PASS, FAIL or SKIP line per step, then a total:
//   1 nessie     NESSIE_KEY is in Vercel production and the sandbox lists accounts for it
//   2 instagram  the deployment serves the real reel, else SKIP "seeded reel in use"
//   3 cron       /api/cron/sweep answers 401 (CRON_SECRET set) and not 503 (unset)
//   4 mcp        get_status over REST answers for the MCP_TOKEN_A and MCP_TOKEN_B in .env
//   5 rooms      the byom_rooms table exists (check_plan answers 404, not 503)
//   6 sha        /api/health shows the deployed commit, and matches --expect-sha when given
//
// SKIP means the step could not be tested (a key is not in .env yet, the station is closed); FAIL means the step
// is not done or is wrong, and the line says which checklist step to do. Exit 0 when nothing fails, 1 when
// any step fails, 2 for a bad command line.
//
// Read-only on purpose: every request is a GET, nothing is created or changed, and the cron sweep is only asked
// without its secret, so it answers 401 or 503 and never runs. Keys are read from .env, held in memory, sent only
// to the service they belong to, and scrubbed from every printed line.

import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const DEFAULT_BASE = "https://www.musefriends.tech";
const VERCEL_PROJECT = "muse-friends";
const VERCEL_SCOPE = "aaron-sulbaran-projects";
const NESSIE_BASE = "https://api.nessieisreal.com";
const TIMEOUT_MS = 20_000;
const PROBE_PLAN_ID = "room_laptop_check_probe";

export function parseArgs(argv) {
  const options = { base: process.env.LAPTOP_CHECK_BASE_URL ?? DEFAULT_BASE, expectSha: null, envFile: ".env", help: false, error: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => argv[++index];
    if (argument === "--base") options.base = value();
    else if (argument === "--expect-sha") options.expectSha = value();
    else if (argument === "--env-file") options.envFile = value();
    else if (argument === "--help" || argument === "-h") options.help = true;
    else options.error = `unknown option: ${argument}`;
  }
  if (typeof options.base !== "string" || !/^https?:\/\/[^\s/]+/.test(options.base)) options.error ??= "--base needs an address like https://www.musefriends.tech";
  else options.base = options.base.replace(/\/+$/, "");
  if (options.expectSha !== null && !/^[0-9a-f]{4,40}$/i.test(String(options.expectSha))) options.error ??= "--expect-sha needs at least 4 hex characters of a commit";
  if (options.expectSha !== null) options.expectSha = String(options.expectSha).toLowerCase();
  return options;
}

// KEY=value lines, with or without quotes; comments and blanks ignored. Values are returned, never printed.
export function parseEnvFile(text) {
  const values = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"') && value.length >= 2) || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

export function readEnvFile(path) {
  try {
    return parseEnvFile(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}

const result = (step, name, verdict, detail) => ({ step, name, verdict, detail });
const pass = (step, name, detail) => result(step, name, "PASS", detail);
const fail = (step, name, detail) => result(step, name, "FAIL", detail);
const skip = (step, name, detail) => result(step, name, "SKIP", detail);

// Every verdict line goes through this: any secret that is ever in memory is replaced before printing.
export function redact(text, secrets) {
  let out = String(text);
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 6) out = out.split(secret).join("[redacted]");
  }
  return out;
}

export function formatResult(item, secrets = []) {
  return redact(`  ${item.verdict}  ${item.step} ${item.name.padEnd(9)} ${item.detail}`, secrets);
}

export function summarize(results) {
  const count = (verdict) => results.filter((item) => item.verdict === verdict).length;
  const failed = count("FAIL");
  return { line: `LAPTOP CHECK: ${count("PASS")} PASS, ${failed} FAIL, ${count("SKIP")} SKIP`, exitCode: failed > 0 ? 1 : 0 };
}

// ---------------------------------------------------------------------------
// The calls. All GET, all with a timeout; a network error is a status of 0.
// ---------------------------------------------------------------------------

async function get(fetchImpl, url, headers = {}) {
  try {
    const response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json };
  } catch (error) {
    return { status: 0, json: null, error: error instanceof Error ? error.name : "error" };
  }
}

const bearer = (token) => ({ authorization: `Bearer ${token}` });

// ---------------------------------------------------------------------------
// The six steps, each a pure function of what it is given, so tests can drive them with fakes.
// ---------------------------------------------------------------------------

// 1. NESSIE_KEY is configured in Vercel production, and the key from .env opens the sandbox. Read-only: it lists
// accounts and creates nothing. `vercelNames` is a Set of production variable names, or null when unavailable.
export async function checkNessie({ key, vercelNames, fetchImpl, nessieBase = NESSIE_BASE }) {
  const inVercel = vercelNames === null ? null : vercelNames.has("NESSIE_KEY");
  if (inVercel === false) return fail(1, "nessie", "NESSIE_KEY is not in Vercel production (checklist step 1.4: vercel env add NESSIE_KEY production, then redeploy)");
  let sandbox = null;
  if (key) {
    const listed = await get(fetchImpl, `${nessieBase.replace(/\/+$/, "")}/accounts?key=${encodeURIComponent(key)}`);
    if (listed.status === 200 && Array.isArray(listed.json)) sandbox = { ok: true, count: listed.json.length };
    else if (listed.status === 401 || listed.status === 403) return fail(1, "nessie", `the sandbox rejected the key in .env (${listed.status}); copy it again from nessieisreal.com (checklist step 1.1 to 1.3)`);
    else return fail(1, "nessie", `the sandbox did not answer a read-only account list (${listed.status === 0 ? "no answer" : listed.status}); try again, or check https://nessieisreal.com`);
  }
  if (inVercel === true && sandbox) return pass(1, "nessie", `NESSIE_KEY is in Vercel production and the sandbox lists ${sandbox.count} account${sandbox.count === 1 ? "" : "s"}`);
  if (inVercel === true) return skip(1, "nessie", "NESSIE_KEY is in Vercel production; it is not in .env, so the sandbox was not probed (checklist step 1.3)");
  if (sandbox) return skip(1, "nessie", `the sandbox lists ${sandbox.count} account${sandbox.count === 1 ? "" : "s"} for the key in .env; the Vercel variable list was not available, so the deployment was not checked (log in with the vercel CLI)`);
  return skip(1, "nessie", "no NESSIE_KEY in .env and the Vercel variable list was not available (checklist step 1)");
}

// 2. The deployment reads the real reel from Instagram. /api/state carries `reel` when it did, else null (the
// seeded, fictional reel). Without the token that is the expected state, so it is a SKIP and never a FAIL.
export function checkInstagram({ state, vercelNames }) {
  if (!state || state.status !== 200 || typeof state.json !== "object" || state.json === null) {
    return fail(2, "instagram", `/api/state did not answer (${state?.status || "no answer"}), so the reel could not be read`);
  }
  const reel = state.json.reel;
  if (reel && typeof reel === "object" && typeof reel.username === "string" && reel.username) {
    return pass(2, "instagram", `the real reel is served, read live from @${reel.username}`);
  }
  const inRoom = Array.isArray(state.json.messages) && state.json.messages.length > 0;
  const why =
    vercelNames === null
      ? ""
      : vercelNames.has("INSTAGRAM_ACCESS_TOKEN")
        ? ": the token is in Vercel, so redeploy, or Instagram is refusing it"
        : ": INSTAGRAM_ACCESS_TOKEN is not in Vercel production (checklist step 2.3)";
  return skip(2, "instagram", `seeded reel in use${why}${inRoom ? " (the demo room holds a run, so this is that run's reel)" : ""}`);
}

// 3. CRON_SECRET: the sweep answers 401 when the secret exists and you did not send it, 503 when it is unset.
export function checkCron({ response }) {
  if (response.status === 401) return pass(3, "cron", "/api/cron/sweep answered 401: the secret is set and the route is closed without it");
  if (response.status === 503) return fail(3, "cron", "/api/cron/sweep answered 503: CRON_SECRET is not set in the deployment (checklist step 3, then redeploy)");
  if (response.status === 200) return fail(3, "cron", "/api/cron/sweep answered 200 without a secret; it must be closed (401)");
  if (response.status === 0) return fail(3, "cron", "/api/cron/sweep did not answer");
  return fail(3, "cron", `/api/cron/sweep answered ${response.status}, expected 401`);
}

// 4. MCP tokens: a request with no key is refused, and get_status over REST answers for each key in .env.
export async function checkMcp({ tokens, fetchImpl, base }) {
  const present = Object.entries(tokens).filter(([, token]) => Boolean(token));
  if (present.length === 0) return skip(4, "mcp", "no MCP_TOKEN_A or MCP_TOKEN_B in .env (checklist step 3 generates them with --with-mcp-tokens)");
  const open = await get(fetchImpl, `${base}/api/connector/status`);
  if (open.status === 200) return fail(4, "mcp", "get_status answered 200 with no key; the connector must be closed without one");
  if (open.status !== 401) return fail(4, "mcp", `get_status with no key answered ${open.status || "nothing"}, expected 401`);
  const lines = [];
  for (const [account, token] of present) {
    const status = await get(fetchImpl, `${base}/api/connector/status`, bearer(token));
    if (status.status === 401) return fail(4, "mcp", `the deployment does not accept MCP_TOKEN_${account.toUpperCase()} from .env (push it with checklist step 3, then redeploy)`);
    const data = status.json?.data;
    if (status.status !== 200 || !data || data.ok !== true) return fail(4, "mcp", `get_status for account ${account} answered ${status.status || "nothing"} without ok: true`);
    lines.push(`account ${account}`);
  }
  return pass(4, "mcp", `get_status over REST answered ok for ${lines.join(" and ")}, and 401 with no key`);
}

// 5. The byom_rooms table: check_plan on an id that cannot exist reads the table and creates nothing. 404 means the
// table answered; 503 means it is missing or unreachable. It needs the judge key, so without one it is a SKIP.
export async function checkRooms({ judgeKey, fetchImpl, base }) {
  if (!judgeKey) return skip(5, "rooms", "no MCP_TOKEN_JUDGE in .env, so the table cannot be probed through the connector (checklist step 5 generates it)");
  const probe = await get(fetchImpl, `${base}/api/connector/check_plan?planId=${PROBE_PLAN_ID}`, bearer(judgeKey));
  const code = probe.json?.error?.code;
  if (probe.status === 404 && code === "no_such_plan") return pass(5, "rooms", "the byom_rooms table answered (an unknown plan id is a clean 404)");
  if (probe.status === 503) return fail(5, "rooms", "the byom_rooms table is missing or unreachable (503): paste the migration, checklist step 4");
  if (probe.status === 401) return skip(5, "rooms", "the deployment does not know this MCP_TOKEN_JUDGE (401), so the station is closed and the table cannot be probed (checklist step 5, then redeploy)");
  if (probe.status === 403) return fail(5, "rooms", "the key in MCP_TOKEN_JUDGE was refused as a team key (403); it must be the judge key");
  return fail(5, "rooms", `check_plan answered ${probe.status || "nothing"}, expected 404 from a working table`);
}

// 6. The deployed commit, from /api/health.
export function checkSha({ health, expectSha }) {
  if (!health || health.status !== 200 || !health.json || typeof health.json.sha !== "string") {
    return fail(6, "sha", `/api/health did not answer with a commit (${health?.status || "no answer"})`);
  }
  const sha = health.json.sha;
  if (expectSha === null) return pass(6, "sha", `health is ok on commit ${sha.slice(0, 7)} (give --expect-sha to compare)`);
  if (sha.toLowerCase().startsWith(expectSha) || expectSha.startsWith(sha.toLowerCase())) return pass(6, "sha", `the deployed commit is ${sha.slice(0, 7)}, as expected`);
  return fail(6, "sha", `the deployed commit is ${sha.slice(0, 7)}, not ${expectSha.slice(0, 7)}: the deploy has not landed, or was refused`);
}

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

// Names of the variables configured for Production, read through the Vercel CLI (names only, never values), or
// null when the CLI is missing or not logged in.
export function vercelProductionNames({ run = execFile } = {}) {
  return new Promise((resolve) => {
    run("vercel", ["api", `/v10/projects/${VERCEL_PROJECT}/env`, "--scope", VERCEL_SCOPE], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        const envs = JSON.parse(String(stdout)).envs;
        if (!Array.isArray(envs)) return resolve(null);
        resolve(new Set(envs.filter((entry) => Array.isArray(entry.target) && entry.target.includes("production")).map((entry) => String(entry.key))));
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * @param {{ base: string, expectSha?: string | null, env: Record<string, string | undefined>, fetchImpl?: typeof fetch, vercelNames?: Set<string> | null, nessieBase?: string }} options
 */
export async function runLaptopCheck({ base, expectSha = null, env, fetchImpl = fetch, vercelNames = null, nessieBase = NESSIE_BASE }) {
  const [health, state, sweep] = await Promise.all([get(fetchImpl, `${base}/api/health`), get(fetchImpl, `${base}/api/state`), get(fetchImpl, `${base}/api/cron/sweep`)]);
  const results = [
    await checkNessie({ key: env.NESSIE_KEY?.trim() || null, vercelNames, fetchImpl, nessieBase }),
    checkInstagram({ state, vercelNames }),
    checkCron({ response: sweep }),
    await checkMcp({ tokens: { a: env.MCP_TOKEN_A?.trim() || "", b: env.MCP_TOKEN_B?.trim() || "" }, fetchImpl, base }),
    await checkRooms({ judgeKey: env.MCP_TOKEN_JUDGE?.trim() || null, fetchImpl, base }),
    checkSha({ health, expectSha }),
  ];
  return results;
}

// Every value in .env that could be a secret, for scrubbing printed lines.
export const secretsIn = (env) => Object.entries(env).filter(([name]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(name)).map(([, value]) => value);

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("usage: pnpm laptop:check [--base URL] [--expect-sha SHA] [--env-file PATH]");
    return 0;
  }
  if (options.error) {
    console.error(`${options.error}\nusage: pnpm laptop:check [--base URL] [--expect-sha SHA] [--env-file PATH]`);
    return 2;
  }
  const env = readEnvFile(options.envFile);
  const secrets = secretsIn(env);
  console.log(`\nLAPTOP CHECK against ${options.base}`);
  const vercelNames = await vercelProductionNames();
  const results = await runLaptopCheck({ base: options.base, expectSha: options.expectSha, env, vercelNames });
  for (const item of results) console.log(formatResult(item, secrets));
  const summary = summarize(results);
  console.log(`\n${summary.line}`);
  return summary.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
