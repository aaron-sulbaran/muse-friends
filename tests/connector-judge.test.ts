import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Next's after() only exists inside a request; here it just records the work, which is never run.
const scheduled = vi.hoisted(() => [] as Array<() => Promise<void>>);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (work: () => Promise<void>) => void scheduled.push(work),
}));

import { GET as checkGet, POST as checkPost } from "@/app/api/connector/check_plan/route";
import { POST as respondPost } from "@/app/api/connector/respond/route";
import { POST as startPost } from "@/app/api/connector/start_plan/route";
import { clearMemoryRooms } from "@/app/api/connector/_lib/rooms";
import { POST as mcpPost } from "@/app/api/mcp/route";
import { resetRunBudget } from "@/lib/agent/caps";

const NOW = Date.parse("2026-10-25T15:00:00-05:00");
const tokenA = "a".repeat(48);
const tokenB = "b".repeat(48);
const tokenJudge = "j".repeat(48);
const goodSlots = { slots: "evenings" };

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const post = (route: typeof startPost, body: unknown, headers: Record<string, string> = {}) =>
  route(new Request("https://muse-friends.test/api/connector/x", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
const get = (query: string, headers: Record<string, string> = {}) => checkGet(new Request(`https://muse-friends.test/api/connector/check_plan${query}`, { headers }));

beforeEach(() => {
  vi.stubEnv("MCP_TOKEN_A", tokenA);
  vi.stubEnv("MCP_TOKEN_B", tokenB);
  vi.stubEnv("MCP_TOKEN_JUDGE", tokenJudge);
  vi.stubEnv("STORE", "");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  clearMemoryRooms();
  resetRunBudget();
  scheduled.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clearMemoryRooms();
  resetRunBudget();
});

function routesWith(headers: Record<string, string>) {
  return [
    ["start_plan", () => post(startPost, goodSlots, headers)],
    ["check_plan GET", () => get("?planId=room_x", headers)],
    ["check_plan POST", () => post(checkPost, { planId: "room_x" }, headers)],
    ["respond", () => post(respondPost, { planId: "room_x", decision: "accept" }, headers)],
  ] as const;
}

describe("the judge routes are closed unless MCP_TOKEN_JUDGE is set", () => {
  it("answers 401 on every route, with any key, while the judge token is unset", async () => {
    vi.stubEnv("MCP_TOKEN_JUDGE", "");
    for (const [name, call] of routesWith(bearer(tokenJudge))) expect((await call()).status, `${name} with the would-be judge key`).toBe(401);
    for (const [name, call] of routesWith(bearer("z".repeat(48)))) expect((await call()).status, `${name} with a random key`).toBe(401);
    for (const [name, call] of routesWith({})) expect((await call()).status, `${name} with no key`).toBe(401);
    expect(scheduled).toHaveLength(0);
  });

  it("also stays closed when the judge token is too short to be one", async () => {
    vi.stubEnv("MCP_TOKEN_JUDGE", "short");
    for (const [name, call] of routesWith(bearer("short"))) expect((await call()).status, name).toBe(401);
  });

  it("answers 401 for a wrong key and 403 for the team's own keys, which are only for get_status", async () => {
    for (const [name, call] of routesWith(bearer("w".repeat(48)))) expect((await call()).status, `${name} wrong key`).toBe(401);
    for (const token of [tokenA, tokenB]) {
      for (const [name, call] of routesWith(bearer(token))) {
        const response = await call();
        expect(response.status, `${name} team key`).toBe(403);
        expect((await response.json()).error.code).toBe("forbidden");
      }
    }
    expect(scheduled).toHaveLength(0);
  });

  it("accepts the judge key as a bearer or as x-api-key", async () => {
    expect((await post(startPost, goodSlots, bearer(tokenJudge))).status).toBe(202);
    expect((await post(startPost, goodSlots, { "x-api-key": tokenJudge })).status).toBe(202);
  });

  it("never writes a key into the logs", async () => {
    await post(startPost, goodSlots, bearer(tokenJudge));
    await post(startPost, goodSlots, bearer("w".repeat(48)));
    const logged = JSON.stringify(vi.mocked(console.log).mock.calls);
    expect(logged).not.toContain(tokenJudge);
    expect(logged).not.toContain("w".repeat(48));
    expect(logged).toContain("accepted=true");
    expect(logged).toContain("accepted=false");
  });
});

describe("REST: start_plan, check_plan, respond", () => {
  const judge = bearer(tokenJudge);

  it("start_plan answers 202 with { data: { planId, contextId, how_to_check } } and schedules the agents", async () => {
    const response = await post(startPost, goodSlots, judge);
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.error).toBeNull();
    expect(body.data).toMatchObject({ state: "negotiating", you: "Sprout", slots: "evenings", expires_in_minutes: 120 });
    expect(Object.keys(body.data).sort()).toEqual(["contextId", "expires_in_minutes", "free_windows", "friend", "how_to_check", "planId", "slots", "state", "you"]);
    expect(body.data.planId).toMatch(/^room_/);
    expect(body.data.how_to_check).toContain("check_plan");
    expect(scheduled).toHaveLength(1);
  });

  it("start_plan refuses what it cannot use: not JSON, an unknown preset, free text, windows of your own", async () => {
    expect((await post(startPost, "not json", judge)).status).toBe(400);
    expect((await post(startPost, { slots: "mornings" }, judge)).status).toBe(400);
    expect((await post(startPost, {}, judge)).status).toBe(400);
    const freeText = await post(startPost, { slots: "evenings", reel_hint: "anything at all" }, judge);
    expect(freeText.status).toBe(400);
    const message = (await freeText.json()).error.message as string;
    expect(message).toContain("reel_hint");
    expect(message).not.toContain("anything at all");
    const ownWindows = await post(startPost, { free_windows: [{ day: "2026-10-29", start: "19:00", end: "21:00" }] }, judge);
    expect(ownWindows.status).toBe(400);
    expect(scheduled).toHaveLength(0);
  });

  it("start_plan answers 429 with Retry-After once the cap on rooms per hour is reached", async () => {
    vi.stubEnv("BYOM_ROOMS_PER_HOUR", "1");
    expect((await post(startPost, goodSlots, judge)).status).toBe(202);
    const second = await post(startPost, goodSlots, judge);
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("300");
    expect((await second.json()).error.code).toBe("room_cap");
  });

  it("check_plan answers 404 for an unknown id and 400 without one, by GET or POST", async () => {
    expect((await get("?planId=room_nope", judge)).status).toBe(404);
    expect((await get("", judge)).status).toBe(400);
    expect((await post(checkPost, { planId: "room_nope" }, judge)).status).toBe(404);
    expect((await post(checkPost, "nope", judge)).status).toBe(400);
  });

  it("check_plan on a started plan says negotiating; respond is refused until the agents agree", async () => {
    const { data } = await (await post(startPost, goodSlots, judge)).json();
    const checked = await (await get(`?planId=${data.planId}`, judge)).json();
    expect(checked.data).toMatchObject({ planId: data.planId, state: "negotiating", messages: [], whatsapp_draft: null });
    const early = await post(respondPost, { planId: data.planId, decision: "accept" }, judge);
    expect(early.status).toBe(409);
    expect((await early.json()).error.code).toBe("not_waiting_for_you");
    expect((await post(respondPost, { planId: "room_nope", decision: "accept" }, judge)).status).toBe(404);
    expect((await post(respondPost, { planId: data.planId, decision: "maybe" }, judge)).status).toBe(400);
  });
});

describe("MCP: start_plan, check_plan, respond beside get_status", () => {
  const call = (headers: Record<string, string>, method: string, params?: unknown) =>
    mcpPost(
      new Request("https://muse-friends.test/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
  const message = async (response: Response) => {
    const text = await response.text();
    return JSON.parse(text.split("\n").find((line) => line.startsWith("data: "))!.slice("data: ".length));
  };
  const tool = async (headers: Record<string, string>, name: string, args: unknown) => (await message(await call(headers, "tools/call", { name, arguments: args }))).result;

  it("lists the four tools", async () => {
    const result = (await message(await call(bearer(tokenJudge), "tools/list"))).result;
    expect(result.tools.map((entry: { name: string }) => entry.name).sort()).toEqual(["check_plan", "get_status", "respond", "start_plan"]);
  });

  it("is closed to the team's keys for the new tools, and to everyone when the judge token is unset", async () => {
    for (const name of ["start_plan", "check_plan", "respond"]) {
      const args = name === "start_plan" ? goodSlots : { planId: "room_x", decision: "accept" };
      const result = await tool(bearer(tokenA), name, args);
      expect(result.isError, name).toBe(true);
      expect(JSON.parse(result.content[0].text).error.code).toBe("forbidden");
    }
    vi.stubEnv("MCP_TOKEN_JUDGE", "");
    expect((await call(bearer(tokenJudge), "tools/list")).status).toBe(401);
    expect(scheduled).toHaveLength(0);
  });

  it("start_plan returns the room, check_plan reads it, and an unknown plan is an error result", async () => {
    const started = await tool(bearer(tokenJudge), "start_plan", goodSlots);
    expect(started.isError).toBeUndefined();
    const view = JSON.parse(started.content[0].text);
    expect(view).toMatchObject({ state: "negotiating", you: "Sprout" });
    expect(view.planId).toMatch(/^room_/);
    expect(scheduled).toHaveLength(1);

    const checked = JSON.parse((await tool(bearer(tokenJudge), "check_plan", { planId: view.planId })).content[0].text);
    expect(checked).toMatchObject({ planId: view.planId, state: "negotiating" });

    const unknown = await tool(bearer(tokenJudge), "check_plan", { planId: "room_nope" });
    expect(unknown.isError).toBe(true);
    expect(JSON.parse(unknown.content[0].text).error.code).toBe("no_such_plan");
  });

  it("start_plan with free text, windows of your own, or an unknown preset is refused, as a tool error or a protocol error, and starts nothing", async () => {
    for (const args of [
      { slots: "evenings", reel_hint: "anything at all" },
      { free_windows: [{ day: "2026-10-29", start: "19:00", end: "21:00" }] },
      { slots: "mornings" },
      {},
    ]) {
      const response = await message(await call(bearer(tokenJudge), "tools/call", { name: "start_plan", arguments: args }));
      expect(Boolean(response.error) || response.result?.isError === true, JSON.stringify(args)).toBe(true);
    }
    expect(scheduled).toHaveLength(0);
  });

  it("start_plan's schema allows exactly one property, slots, an enum of the three presets", async () => {
    const result = (await message(await call(bearer(tokenJudge), "tools/list"))).result;
    const startPlanTool = result.tools.find((entry: { name: string }) => entry.name === "start_plan");
    expect(Object.keys(startPlanTool.inputSchema.properties)).toEqual(["slots"]);
    expect(startPlanTool.inputSchema.properties.slots.enum).toEqual(["evenings", "lunches", "weekend"]);
    expect(startPlanTool.inputSchema.additionalProperties).toBe(false);
  });
});
