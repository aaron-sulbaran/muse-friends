import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Next's after() only exists inside a request; here it records the work. The jobs are never run, so no test below
// reaches a model: what is checked is which room each call writes to.
const scheduled = vi.hoisted(() => [] as Array<() => Promise<void>>);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (work: () => Promise<void>) => void scheduled.push(work),
}));

import { converse, chooseRoom, freshRoomSnapshot, maxPhoneRooms, phoneRoomKey, withRoom, withoutRoom, type RoomDeps } from "@/app/api/_lib/room";
import { GET as stateGet } from "@/app/api/state/route";
import { POST as chatPost } from "@/app/api/chat/route";
import { POST as clockPost } from "@/app/api/clock/route";
import { clearMemoryRooms, memoryRoomRepo } from "@/app/api/connector/_lib/rooms";
import { POST as controlsPost } from "@/app/api/controls/route";
import { POST as signalsPost } from "@/app/api/signals/route";
import { POST as decisionPost } from "@/app/api/plans/[id]/decision/route";
import { GET as draftGet, POST as draftPost } from "@/app/api/plans/[id]/draft/route";
import { GET as holdGet } from "@/app/api/plans/[id]/hold.ics/route";
import { POST as outcomePost } from "@/app/api/plans/[id]/outcome/route";
import { POST as settlePost } from "@/app/api/plans/[id]/settle/route";
import { POST as simulatedFriendPost } from "@/app/api/simulated-friend/route";
import { resetRunBudget } from "@/lib/agent/caps";
import { recordedSnapshot } from "@/lib/seed/fixtures";
import { getStore } from "@/lib/store";

const A = "roomaaaa1";
const B = "roombbbb2";
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const post = (route: (request: Request, ctx: never) => Promise<Response>, url: string, body: unknown = {}, ctx?: unknown) => route(new Request(`https://muse-friends.test${url}`, json(body)), ctx as never);
const planCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const stateOf = async (id: string) => (await memoryRoomRepo().load(phoneRoomKey(id), Date.now())) ?? null;

let demoFile: string;

beforeEach(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "muse-rooms-"));
  demoFile = path.join(dir, "store.json");
  vi.stubEnv("STORE", "json");
  vi.stubEnv("STORE_PATH", demoFile);
  vi.stubEnv("MCP_TOKEN_JUDGE", "");
  delete (globalThis as { __museStore?: unknown }).__museStore;
  clearMemoryRooms();
  resetRunBudget();
  scheduled.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  await getStore();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete (globalThis as { __museStore?: unknown }).__museStore;
  clearMemoryRooms();
  resetRunBudget();
});

describe("which room a call is for", () => {
  const request = (query: string) => new Request(`https://muse-friends.test/api/x${query}`);

  it("is the demo room with no room, an empty one, or demo; a phone room for any other valid id", () => {
    expect(chooseRoom(request(""))).toEqual({ kind: "demo" });
    expect(chooseRoom(request("?room="))).toEqual({ kind: "demo" });
    expect(chooseRoom(request("?room=demo"))).toEqual({ kind: "demo" });
    expect(chooseRoom(request("?room=abc123"))).toEqual({ kind: "phone", id: "abc123" });
  });

  it("reads the id from the body too, with the query winning, and refuses an id the app's own reader would not send", () => {
    expect(chooseRoom(request(""), { room: "bodyroom1" })).toEqual({ kind: "phone", id: "bodyroom1" });
    expect(chooseRoom(request("?room=queryroom1"), { room: "bodyroom1" })).toEqual({ kind: "phone", id: "queryroom1" });
    for (const bad of ["Shots-1", "ab", "x".repeat(25), "with space", "UPPER123"]) expect(chooseRoom(request(`?room=${encodeURIComponent(bad)}`)).kind, bad).toBe("bad");
  });

  it("keeps a keyless judge code for its link, but only while the judge key is set", () => {
    expect(chooseRoom(request("?room=k7m2xq9"))).toEqual({ kind: "phone", id: "k7m2xq9" });
    vi.stubEnv("MCP_TOKEN_JUDGE", "j".repeat(48));
    expect(chooseRoom(request("?room=k7m2xq9"))).toEqual({ kind: "judge" });
    expect(chooseRoom(request("?room=roomaaaa1"))).toEqual({ kind: "phone", id: "roomaaaa1" });
  });

  it("strips the room from a body so the routes keep their strict schemas", () => {
    expect(withoutRoom({ role: "a", room: "abc123" })).toEqual({ role: "a" });
    expect(withoutRoom(null)).toBeNull();
    expect(withoutRoom([1])).toEqual([1]);
  });
});

describe("two rooms side by side", () => {
  it("each gets its own plan from its own reel, and the demo room gets none", async () => {
    const first = await post(signalsPost, `/api/signals?room=${A}`);
    const second = await post(signalsPost, `/api/signals?room=${B}`);
    expect([first.status, second.status]).toEqual([202, 202]);
    const planA = (await first.json()).planId as string;
    const planB = (await second.json()).planId as string;

    const roomA = (await stateOf(A))!;
    const roomB = (await stateOf(B))!;
    expect(roomA.plans.map((plan) => plan.id)).toEqual([planA]);
    expect(roomB.plans.map((plan) => plan.id)).toEqual([planB]);
    expect(roomA.signals).toHaveLength(1);
    expect(roomB.signals).toHaveLength(1);
    expect((await (await getStore()).snapshot()).plans).toHaveLength(0);
    // Each reel starts its own agents after the response, in that room.
    expect(scheduled).toHaveLength(2);
  });

  it("a plan id from one room is not found in another, or in the demo room", async () => {
    const planA = (await (await post(signalsPost, `/api/signals?room=${A}`)).json()).planId as string;
    await post(signalsPost, `/api/signals?room=${B}`);
    const inA = await post(decisionPost, `/api/plans/${planA}/decision?room=${A}`, { role: "a", choice: "accept" }, planCtx(planA));
    expect(inA.status).toBe(409); // found, and refused because the agents have not agreed yet
    const inB = await post(decisionPost, `/api/plans/${planA}/decision?room=${B}`, { role: "a", choice: "accept" }, planCtx(planA));
    expect(inB.status).toBe(404);
    const inDemo = await post(decisionPost, `/api/plans/${planA}/decision`, { role: "a", choice: "accept" }, planCtx(planA));
    expect(inDemo.status).toBe(404);
  });

  it("a reset in one room leaves the other room, and the demo room, as they were", async () => {
    await post(signalsPost, `/api/signals?room=${A}`);
    await post(signalsPost, `/api/signals?room=${B}`);
    await post(signalsPost, "/api/signals");
    expect((await stateOf(A))!.plans).toHaveLength(1);

    const reset = await post(controlsPost, `/api/controls?room=${B}`, { type: "reset" });
    expect(reset.status).toBe(200);
    expect((await stateOf(B))!.plans).toHaveLength(0);
    expect((await stateOf(A))!.plans).toHaveLength(1);
    expect((await (await getStore()).snapshot()).plans).toHaveLength(1);
  });

  it("the simulated friend switch acts on that room only", async () => {
    const on = await post(controlsPost, `/api/controls?room=${A}`, { type: "simulated_friend", on: true });
    expect(on.status).toBe(200);
    expect((await stateOf(A))!.room.simulatedFriend).toBe(true);
    expect((await (await getStore()).getRoom()).simulatedFriend).toBe(false);
    await post(controlsPost, `/api/controls?room=${B}`, { type: "simulated_friend", on: false });
    expect((await stateOf(A))!.room.simulatedFriend).toBe(true);
  });

  it("takes the room from the body as well", async () => {
    await post(signalsPost, `/api/signals?room=${A}`);
    const reset = await post(controlsPost, "/api/controls", { type: "reset", room: A });
    expect(reset.status).toBe(200);
    expect((await stateOf(A))!.plans).toHaveLength(0);
  });
});

describe("the demo room is left alone by a write with a room id", () => {
  it("is byte for byte the same, in memory and on disk, after a reel, controls and a decision in a room", async () => {
    const demo = await getStore();
    await demo.replaceAll(recordedSnapshot());
    const before = JSON.stringify(await demo.snapshot());
    const fileBefore = readFileSync(demoFile, "utf8");
    const mtimeBefore = statSync(demoFile).mtimeMs;

    const plan = (await (await post(signalsPost, `/api/signals?room=${A}`)).json()).planId as string;
    await post(controlsPost, `/api/controls?room=${A}`, { type: "simulated_friend", on: true });
    await post(controlsPost, `/api/controls?room=${A}`, { type: "payments", side: "a", enabled: true, cap: 20 });
    await post(decisionPost, `/api/plans/${plan}/decision?room=${A}`, { role: "a", choice: "accept" }, planCtx(plan));
    await post(clockPost, `/api/clock?room=${A}`, { action: "advance" });
    await post(controlsPost, `/api/controls?room=${A}`, { type: "reset" });

    expect(JSON.stringify(await (await getStore()).snapshot())).toBe(before);
    expect(readFileSync(demoFile, "utf8")).toBe(fileBefore);
    expect(statSync(demoFile).mtimeMs).toBe(mtimeBefore);
  });

  it("still serves a call with no room from the demo room, as before", async () => {
    const response = await post(signalsPost, "/api/signals");
    expect(response.status).toBe(202);
    expect((await (await getStore()).snapshot()).plans).toHaveLength(1);
    expect(await stateOf("demo")).toBeNull();
  });
});

describe("a room is made on its first write, and not before", () => {
  it("answers 404 to every call that cannot make a room, when the room does not exist", async () => {
    const unknown = "neverseen1";
    const calls: Array<[string, Response]> = [
      ["decision", await post(decisionPost, `/api/plans/p/decision?room=${unknown}`, { role: "a", choice: "accept" }, planCtx("p"))],
      ["handoff", await post(draftPost, `/api/plans/p/draft?room=${unknown}`, { role: "a", via: "copy" }, planCtx("p"))],
      ["draft", await draftGet(new Request(`https://muse-friends.test/api/plans/p/draft?room=${unknown}`), planCtx("p") as never)],
      ["outcome", await post(outcomePost, `/api/plans/p/outcome?room=${unknown}`, { role: "a", result: "went" }, planCtx("p"))],
      ["settle", await post(settlePost, `/api/plans/p/settle?room=${unknown}`, { role: "a" }, planCtx("p"))],
      ["clock", await post(clockPost, `/api/clock?room=${unknown}`, { action: "advance" })],
      ["simulated friend", await post(simulatedFriendPost, `/api/simulated-friend?room=${unknown}`, { planId: "p" })],
      ["chat", await post(chatPost, `/api/chat?room=${unknown}`, { text: "what is the plan?" })],
    ];
    for (const [name, response] of calls) {
      expect(response.status, name).toBe(404);
      expect((await response.json()).error.code, name).toBe("no_such_room");
    }
    expect(await stateOf(unknown)).toBeNull();
  });

  it("answers the calendar hold of a room that does not exist with no plan, and of a room's own plan from that room", async () => {
    const missing = await holdGet(new Request("https://muse-friends.test/api/plans/p/hold.ics?room=neverseen2"), planCtx("p") as never);
    expect(missing.status).toBe(404);
    const planA = (await (await post(signalsPost, `/api/signals?room=${A}`)).json()).planId as string;
    // The plan exists in room A but has no time yet (the agents have not agreed), so it is found and refused with 409.
    expect((await holdGet(new Request(`https://muse-friends.test/api/plans/${planA}/hold.ics?room=${A}`), planCtx(planA) as never)).status).toBe(409);
    expect((await holdGet(new Request(`https://muse-friends.test/api/plans/${planA}/hold.ics?room=${B}`), planCtx(planA) as never)).status).toBe(404);
    expect((await holdGet(new Request(`https://muse-friends.test/api/plans/${planA}/hold.ics`), planCtx(planA) as never)).status).toBe(404);
  });

  it("makes the room on a reel and on a control, with the empty stage, and nobody playing the friend yet", async () => {
    expect((await post(controlsPost, `/api/controls?room=${A}`, { type: "reset" })).status).toBe(200);
    expect((await post(signalsPost, `/api/signals?room=${B}`)).status).toBe(202);
    for (const id of [A, B]) {
      const room = (await stateOf(id))!;
      expect(room.room).toMatchObject({ id: "demo", simulatedFriend: false });
    }
  });

  it("starts a new room with the demo room's wallet accounts at their starting balance, and reads the demo room without changing it", async () => {
    const demo = await getStore();
    const wallets = {
      aaron: { owner: "aaron", customerId: "c1", accountId: "acc_a", nickname: "Sprout wallet", balance: 77, startingBalance: 120, source: "local", updatedAt: "2026-10-25T03:00:00-05:00" },
      lisa: { owner: "lisa", customerId: "c2", accountId: "acc_b", nickname: "Mochi wallet", balance: 150, startingBalance: 80, source: "local", updatedAt: "2026-10-25T03:00:00-05:00" },
    };
    await demo.putRoom({ ...(await demo.getRoom()), wallets: wallets as never, localLedger: { acc_a: 77, acc_b: 150 } });
    const before = JSON.stringify(await demo.snapshot());
    const fresh = await freshRoomSnapshot(Date.now());
    expect(fresh.room.wallets?.aaron).toMatchObject({ accountId: "acc_a", balance: 120 });
    expect(fresh.room.wallets?.lisa).toMatchObject({ accountId: "acc_b", balance: 80 });
    expect(fresh.room.localLedger).toBeUndefined();
    expect(JSON.stringify(await demo.snapshot())).toBe(before);
  });
});

describe("refusals", () => {
  it("answers 400 for an id the app would not send, 403 for a judge's link code, and never touches the demo room", async () => {
    const demo = await getStore();
    const before = JSON.stringify(await demo.snapshot());
    const bad = await post(signalsPost, "/api/signals?room=Not-Valid");
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("bad_room");
    vi.stubEnv("MCP_TOKEN_JUDGE", "j".repeat(48));
    const judge = await post(signalsPost, "/api/signals?room=k7m2xq9");
    expect(judge.status).toBe(403);
    expect((await judge.json()).error.code).toBe("judge_room");
    expect((await post(controlsPost, "/api/controls?room=k7m2xq9", { type: "reset" })).status).toBe(403);
    expect(JSON.stringify(await demo.snapshot())).toBe(before);
  });

  it("caps new rooms an hour, counting phone rooms only, and answers 429 with Retry-After", async () => {
    vi.stubEnv("PHONE_ROOMS_PER_HOUR", "2");
    // Judge rooms share the table but are not counted against phone rooms.
    const repo = memoryRoomRepo();
    await repo.create("room_judge_one", (await freshRoomSnapshot(Date.now())), Date.now());
    await repo.create("j_k7m2xq9", (await freshRoomSnapshot(Date.now())), Date.now());
    expect((await post(signalsPost, "/api/signals?room=roomcap01")).status).toBe(202);
    expect((await post(signalsPost, "/api/signals?room=roomcap02")).status).toBe(202);
    const third = await post(signalsPost, "/api/signals?room=roomcap03");
    expect(third.status).toBe(429);
    expect(third.headers.get("retry-after")).toBe("300");
    expect((await third.json()).error.code).toBe("room_cap");
    // An existing room keeps working past the cap.
    expect((await post(controlsPost, "/api/controls?room=roomcap01", { type: "reset" })).status).toBe(200);
    expect(maxPhoneRooms({ maxRoomsPerHour: 5 } as RoomDeps)).toBe(5);
  });

  it("keeps the room's own run cap, apart from the demo room's", async () => {
    vi.stubEnv("MAX_LIVE_RUNS_PER_ROOM_PER_HOUR", "1");
    vi.stubEnv("MAX_LIVE_RUNS_PER_HOUR", "50");
    expect((await post(signalsPost, `/api/signals?room=${A}`)).status).toBe(202);
    expect((await post(signalsPost, `/api/signals?room=${A}`)).status).toBe(429);
    expect((await post(signalsPost, `/api/signals?room=${B}`)).status).toBe(202);
    expect((await post(signalsPost, "/api/signals")).status).toBe(202);
  });
});

describe("work after the response, in a room", () => {
  // A room built by hand, so a job can be run and its effects read, with no model anywhere.
  function harness() {
    const repo = memoryRoomRepo();
    const jobs: Array<() => Promise<void>> = [];
    const deps: RoomDeps = { repo, now: () => Date.now(), schedule: (work) => void jobs.push(work) };
    const call = (id: string, handler: Parameters<typeof withRoom>[3], options: { mint?: boolean } = { mint: true }) =>
      withRoom(new Request(`https://muse-friends.test/api/x?room=${id}`), undefined, options, handler, deps);
    return { repo, jobs, call };
  }

  it("runs on the latest saved state, which includes what the request wrote, and saves what the job writes", async () => {
    const { repo, jobs, call } = harness();
    const seen: string[] = [];
    const response = await call("jobroom01", async (room) => {
      await room.store.appendEvent({ id: "evt_from_request", at: "2026-10-25T03:00:00-05:00", kind: "plan_state", actor: "system", text: "written by the request" });
      room.background(async (scope) => {
        seen.push(...(await scope.store.listEvents()).map((event) => event.id));
        await scope.store.appendEvent({ id: "evt_from_job", at: "2026-10-25T03:00:01-05:00", kind: "plan_state", actor: "system", text: "written by the job" });
      });
      return Response.json({ ok: true });
    });
    expect(response.status).toBe(200);
    expect(jobs).toHaveLength(1);
    expect((await repo.load(phoneRoomKey("jobroom01"), Date.now()))!.events.map((event) => event.id)).toContain("evt_from_request");
    await jobs[0]();
    expect(seen).toContain("evt_from_request");
    expect((await repo.load(phoneRoomKey("jobroom01"), Date.now()))!.events.map((event) => event.id)).toEqual(expect.arrayContaining(["evt_from_request", "evt_from_job"]));
  });

  it("serializes two calls to one room, so neither loses the other's write", async () => {
    const { repo, call } = harness();
    await call("lockroom01", async () => Response.json({}));
    const gate: { release: () => void } = { release: () => {} };
    const held = new Promise<void>((resolve) => (gate.release = resolve));
    const slow = call("lockroom01", async (room) => {
      await held;
      await room.store.appendEvent({ id: "evt_slow", at: "2026-10-25T03:00:00-05:00", kind: "plan_state", actor: "system", text: "slow" });
      return Response.json({});
    });
    const fast = call("lockroom01", async (room) => {
      await room.store.appendEvent({ id: "evt_fast", at: "2026-10-25T03:00:01-05:00", kind: "plan_state", actor: "system", text: "fast" });
      return Response.json({});
    });
    gate.release();
    await Promise.all([slow, fast]);
    expect((await repo.load(phoneRoomKey("lockroom01"), Date.now()))!.events.map((event) => event.id).sort()).toEqual(["evt_fast", "evt_slow"]);
  });

  it("a demo-room scope sends messages over the inbox and leaves the receiver's turn to it", async () => {
    const response = await withRoom(new Request("https://muse-friends.test/api/x"), undefined, {}, async (room) => {
      expect(room.isDemo).toBe(true);
      expect(room.id).toBe("demo");
      let ran = false;
      await converse(room, "ctx_x", async () => {
        ran = true;
      });
      expect(ran).toBe(true);
      expect(room.pending).toEqual([]);
      return Response.json({});
    });
    expect(response.status).toBe(200);
  });

  it("converse in a room with nothing owed runs only the first step", async () => {
    const { call } = harness();
    let steps = 0;
    await call("converse01", async (room) => {
      expect(room.isDemo).toBe(false);
      await converse(room, "ctx_x", async () => {
        steps += 1;
      });
      return Response.json({});
    });
    expect(steps).toBe(1);
  });

  it("is a 503, not a crash, when the room table is not there", async () => {
    const broken = { ...memoryRoomRepo(), lookup: async () => { throw new (await import("@/app/api/connector/_lib/rooms")).RoomStorageError("lookup", "relation does not exist"); } };
    const response = await withRoom(new Request("https://muse-friends.test/api/x?room=brokenroom1"), undefined, { mint: true }, async () => Response.json({}), { repo: broken, now: Date.now, schedule: () => {} });
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("rooms_unavailable");
  });
});

describe("the repository count by prefix", () => {
  it("counts only the keys that start with the prefix, and all of them without one", async () => {
    const repo = memoryRoomRepo();
    const snapshot = await freshRoomSnapshot(Date.now());
    await repo.create("p_one", snapshot, Date.now());
    await repo.create("p_two", snapshot, Date.now());
    await repo.create("j_code", snapshot, Date.now());
    await repo.create("room_abc", snapshot, Date.now());
    expect(await repo.countCreatedSince(0, "p_")).toBe(2);
    expect(await repo.countCreatedSince(0, "j_")).toBe(1);
    expect(await repo.countCreatedSince(0)).toBe(4);
  });
});

describe("/api/state for a phone room", () => {
  const read = (query: string, headers: Record<string, string> = {}) => stateGet(new Request(`https://muse-friends.test/api/state${query}`, { headers }));

  it("shows the empty stage for a room nobody has written to yet, without making it", async () => {
    const response = await read(`?room=${A}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ mode: "live", plan: null, messages: [], simulatedFriend: false });
    expect(await stateOf(A)).toBeNull();
  });

  it("shows each room its own plan and the demo room its own, and answers 304 until the room changes", async () => {
    await post(signalsPost, `/api/signals?room=${A}`);
    const inA = await read(`?room=${A}`);
    const inB = await read(`?room=${B}`);
    const inDemo = await read("");
    expect((await inA.clone().json()).plan?.state).toBe("detected");
    expect((await inB.json()).plan).toBeNull();
    expect((await inDemo.json()).plan).toBeNull();
    const etag = inA.headers.get("etag")!;
    expect(etag).toMatch(/^"room-/);
    expect((await read(`?room=${A}`, { "if-none-match": etag })).status).toBe(304);
    await post(controlsPost, `/api/controls?room=${A}`, { type: "simulated_friend", on: true });
    expect((await read(`?room=${A}`, { "if-none-match": etag })).status).toBe(200);
  });

  it("leaves a judge's code and the demo room to their own readers", async () => {
    vi.stubEnv("MCP_TOKEN_JUDGE", "j".repeat(48));
    const judge = await read("?room=k7m2xq9");
    // No such judge room: the demo room answers, as it did before phone rooms existed.
    expect(judge.status).toBe(200);
    expect((await judge.json()).plan).toBeNull();
  });
});
