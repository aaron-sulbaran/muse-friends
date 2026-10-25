import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Next's after() only exists inside a request; here it records the work, which the route tests never run.
const scheduled = vi.hoisted(() => [] as Array<() => Promise<void>>);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (work: () => Promise<void>) => void scheduled.push(work),
}));
// The demo room's own source, replaced by markers so the /api/state test can tell which room answered.
vi.mock("@/lib/ui/source", () => ({ readCursor: async () => "demo-1", readSnapshot: async () => ({ marker: "demo room" }) }));

import { GET as stateGet } from "@/app/api/state/route";
import { checkPlan, type ByomDeps } from "@/app/api/connector/_lib/byom";
import { GET as codeGet } from "@/app/api/connector/code/route";
import { answerFromPage, mintCode, normalizeCode, readJudgeRoom, roomKeyOfCode, startFromPicks, viewLink } from "@/app/api/connector/_lib/keyless";
import { CANDIDATE_MOCHI_FREE, CANDIDATE_SLOTS, candidateLabel } from "@/app/api/connector/_lib/presets";
import { ROOM_TTL_MS, clearMemoryRooms, memoryRoomRepo } from "@/app/api/connector/_lib/rooms";
import { POST as connectCodePost } from "@/app/connect/code/route";
import { GET as pageGet } from "@/app/j/[code]/route";
import { POST as answerPost } from "@/app/j/[code]/answer/route";
import { POST as startPost } from "@/app/j/[code]/start/route";
import { linkPage, planPage } from "@/app/j/_lib/pages";
import { ownFreeBlocks } from "@/lib/agent/calendar";
import { resetRunBudget } from "@/lib/agent/caps";
import { intersectWindows, toMs } from "@/lib/agent/windows";
import { transitionPlan } from "@/lib/plans";
import type { Plan } from "@/lib/protocol";
import { CALENDAR_RANGE, recordedSnapshot } from "@/lib/seed/fixtures";
import { getStore, type Store } from "@/lib/store";
import { JsonStore } from "@/lib/store/json";

const NOW = Date.parse("2026-10-25T15:00:00-05:00");
const judgeKey = "j".repeat(48);
const candidate = (id: string) => CANDIDATE_SLOTS.find((entry) => entry.id === id)!;

function harness(overrides: Partial<ByomDeps> = {}) {
  const repo = memoryRoomRepo();
  const work: Array<() => Promise<void>> = [];
  let now = NOW;
  const deps: ByomDeps = {
    repo,
    now: () => now,
    schedule: (job) => void work.push(job),
    mochi: async () => "accept",
    negotiate: agree,
    ...overrides,
  };
  return { deps, repo, work, advance: (ms: number) => (now += ms), run: async () => void (await Promise.all(work.splice(0).map((job) => job()))) };
}

// A stand-in for the agents' conversation: three messages, then the plan waits on the people.
async function agree(store: Store, input: { contextId: string }): Promise<void> {
  const [plan] = await store.listPlans();
  for (const [index, record] of recordedSnapshot().messages.slice(0, 3).entries()) {
    await store.appendMessage({ ...record, message: { ...record.message, id: `msg_stub_${index + 1}`, contextId: input.contextId, seq: index + 1 } });
  }
  const at = "2026-10-25T15:00:30-05:00";
  const waiting = transitionPlan(transitionPlan(plan, "negotiating", at), "awaiting_humans", at, { note: "Both agents accepted" });
  await store.putPlan({ ...waiting, window: { start: "2026-10-29T19:00:00-05:00", end: "2026-10-29T21:00:00-05:00" }, activity: { kind: "food", title: "Shawarma", place: "E 6th St" }, draft: "Hey Mochi, shawarma Thursday at 7? Want to go?" } satisfies Plan);
}

async function mint(h: ReturnType<typeof harness>) {
  const result = await mintCode(h.deps);
  if (!result.ok) throw new Error(`mint failed: ${result.code}`);
  return result.value.code;
}

beforeEach(() => {
  vi.stubEnv("MCP_TOKEN_A", "a".repeat(48));
  vi.stubEnv("MCP_TOKEN_JUDGE", judgeKey);
  vi.stubEnv("STORE", "");
  clearMemoryRooms();
  resetRunBudget();
  scheduled.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
  clearMemoryRooms();
  resetRunBudget();
});

describe("the six proposed times", () => {
  it("are six fixed, whole-hour windows inside the demo calendar with unique lowercase ids", () => {
    expect(CANDIDATE_SLOTS).toHaveLength(6);
    expect(new Set(CANDIDATE_SLOTS.map((entry) => entry.id)).size).toBe(6);
    for (const entry of CANDIDATE_SLOTS) {
      expect(entry.id).toMatch(/^[a-z]{3}-\d{2}$/);
      expect(entry.window.start).toMatch(/T\d\d:00:00-05:00$/);
      expect(entry.window.end).toMatch(/T\d\d:00:00-05:00$/);
      expect(toMs(entry.window.start)).toBeGreaterThanOrEqual(toMs(CALENDAR_RANGE.start));
      expect(toMs(entry.window.end)).toBeLessThanOrEqual(toMs(CALENDAR_RANGE.end));
    }
    for (const window of CANDIDATE_MOCHI_FREE) expect(window.start).toMatch(/T\d\d:00:00-05:00$/);
  });

  it("mostly overlap Mochi, with Wednesday as the decoy she cannot do", () => {
    const mochi = [...CANDIDATE_MOCHI_FREE];
    const workable = CANDIDATE_SLOTS.filter((entry) => intersectWindows([entry.window], mochi).length > 0).map((entry) => entry.id);
    expect(workable).toEqual(["tue-18", "thu-19", "fri-12", "sat-11", "sat-19"]);
    expect(intersectWindows([candidate("wed-18").window], mochi)).toHaveLength(0);
  });

  it("are labelled by day, date and hours", () => {
    expect(candidateLabel(candidate("tue-18").window)).toBe("Tue Oct 27, 6 to 8pm");
    expect(candidateLabel(candidate("sat-11").window)).toBe("Sat Oct 31, 11am to 1pm");
  });
});

describe("codes", () => {
  it("are seven lowercase letters and digits with no i, l, o, 0 or 1; case and spaces are forgiven", () => {
    expect(normalizeCode("k7m2xq9")).toBe("k7m2xq9");
    expect(normalizeCode("  K7M2XQ9 ")).toBe("k7m2xq9");
    for (const bad of ["k7m2xq", "k7m2xq99", "k7m2xql", "k7m2xq0", "k7m2xq1", "k7m2xqo", "k7m2xqi", "k7m2-q9", "", undefined, null]) {
      expect(normalizeCode(bad as string), String(bad)).toBeNull();
    }
  });

  it("are minted as an empty room that lasts 2 hours, and the cap on rooms per hour counts them", async () => {
    const h = harness({ maxRoomsPerHour: 2 });
    const result = await mintCode(h.deps);
    expect(result).toMatchObject({ ok: true, value: { expires_in_minutes: 120 } });
    const code = result.ok ? result.value.code : "";
    expect(code).toMatch(/^[a-hj-km-np-z2-9]{7}$/);
    const snapshot = (await h.repo.load(roomKeyOfCode(code), NOW))!;
    expect(snapshot.plans).toHaveLength(0);
    expect(snapshot.room.simulatedFriend).toBe(true);
    await mint(h);
    expect(await mintCode(h.deps)).toMatchObject({ ok: false, status: 429, code: "room_cap", retryAfterSeconds: 300 });
    h.advance(61 * 60 * 1000);
    expect((await mintCode(h.deps)).ok).toBe(true);
  });

  it("are all different across many mints", async () => {
    const h = harness({ maxRoomsPerHour: 1000 });
    const codes = new Set<string>();
    for (let index = 0; index < 60; index += 1) codes.add(await mint(h));
    expect(codes.size).toBe(60);
  });
});

describe("viewing a link", () => {
  it("shows the six times to tick before a plan exists, labelled, with no plan", async () => {
    const h = harness();
    const code = await mint(h);
    const view = await viewLink(code, h.deps);
    expect(view.ok && view.value.phase).toBe("pick");
    if (!view.ok || view.value.phase !== "pick") return;
    expect(view.value.candidates.map((entry) => entry.id)).toEqual(["tue-18", "wed-18", "thu-19", "fri-12", "sat-11", "sat-19"]);
    expect(view.value.candidates[0].label).toBe("Tue Oct 27, 6 to 8pm");
    expect(view.value.minutesLeft).toBe(120);
  });

  it("answers 404 for a code that does not exist and 410 for one that has expired", async () => {
    const h = harness();
    const code = await mint(h);
    expect(await viewLink("zzzzzzz", h.deps)).toMatchObject({ ok: false, status: 404, code: "no_such_code" });
    expect(await viewLink("not a code", h.deps)).toMatchObject({ ok: false, status: 404 });
    h.advance(ROOM_TTL_MS + 1000);
    expect(await viewLink(code, h.deps)).toMatchObject({ ok: false, status: 410, code: "code_expired" });
  });
});

describe("sending the picks", () => {
  it("refuses no picks, an unknown box, and a bad shape, without echoing what was sent", async () => {
    const h = harness();
    const code = await mint(h);
    expect(await startFromPicks(code, [], h.deps)).toMatchObject({ ok: false, status: 400, code: "no_picks" });
    expect(await startFromPicks(code, undefined, h.deps)).toMatchObject({ ok: false, status: 400 });
    const refused = await startFromPicks(code, ["tue-18", "my-real-calendar-9am"], h.deps);
    expect(refused).toMatchObject({ ok: false, status: 400, code: "bad_input" });
    expect(refused.ok ? "" : refused.message).not.toContain("my-real-calendar");
    expect(await startFromPicks(code, [{ id: "tue-18" }], h.deps)).toMatchObject({ ok: false, status: 400 });
    expect(h.work).toHaveLength(0);
    expect((await viewLink(code, h.deps)).ok && (await viewLink(code, h.deps)).ok).toBe(true);
    const snapshot = (await h.repo.load(roomKeyOfCode(code), NOW))!;
    expect(snapshot.plans).toHaveLength(0);
  });

  it("refuses picks Mochi could not also do, and says which she can", async () => {
    const h = harness();
    const code = await mint(h);
    const result = await startFromPicks(code, ["wed-18"], h.deps);
    expect(result).toMatchObject({ ok: false, status: 422, code: "no_overlap_with_mochi" });
    expect(result.ok ? "" : result.message).toContain("Tue Oct 27, 6 to 8pm");
    expect(result.ok ? "" : result.message).not.toContain("Wed Oct 28");
    expect(h.work).toHaveLength(0);
  });

  it("makes the ticks Sprout's calendar and the fixed times Mochi's, starts one plan, and refuses a second send", async () => {
    const h = harness();
    const code = await mint(h);
    const started = await startFromPicks(code, ["thu-19", "tue-18", "tue-18"], h.deps);
    expect(started).toMatchObject({ ok: true, value: { code } });
    expect(h.work).toHaveLength(1);

    const store = new JsonStore(null);
    await store.replaceAll((await h.repo.load(roomKeyOfCode(code), NOW))!);
    expect(await ownFreeBlocks(store, "aaron")).toEqual([candidate("tue-18").window, candidate("thu-19").window]);
    expect(await ownFreeBlocks(store, "lisa")).toEqual(CANDIDATE_MOCHI_FREE);
    expect((await store.snapshot()).plans).toHaveLength(1);

    expect(await startFromPicks(code, ["sat-19"], h.deps)).toMatchObject({ ok: false, status: 409, code: "already_started" });
    expect(h.work).toHaveLength(1);
  });

  it("answers 404 and 410 for a code that is not valid or has expired", async () => {
    const h = harness();
    const code = await mint(h);
    expect(await startFromPicks("zzzzzzz", ["tue-18"], h.deps)).toMatchObject({ ok: false, status: 404 });
    h.advance(ROOM_TTL_MS + 1000);
    expect(await startFromPicks(code, ["tue-18"], h.deps)).toMatchObject({ ok: false, status: 410 });
  });

  it("answers 422 slots_expired once the fictional week is over", async () => {
    const h = harness({ now: () => Date.parse("2026-11-02T12:00:00-05:00") });
    const code = await mint(h);
    expect(await startFromPicks(code, ["tue-18"], h.deps)).toMatchObject({ ok: false, status: 422, code: "slots_expired" });
  });

  it("stops when the app's hourly run budget is spent, and starts nothing", async () => {
    const h = harness();
    const code = await mint(h);
    vi.stubEnv("MAX_LIVE_RUNS_PER_HOUR", "0");
    expect(await startFromPicks(code, ["tue-18"], h.deps)).toMatchObject({ ok: false, status: 429, code: "runs_paused" });
    expect(h.work).toHaveLength(0);
  });
});

describe("a whole visit: mint, tick, send, approve", () => {
  it("runs through to a confirmed plan on the in-memory store, and Approve is refused before they agree", async () => {
    const h = harness();
    const code = await mint(h);
    expect(await answerFromPage(code, "accept", h.deps)).toMatchObject({ ok: false, status: 409 });
    expect((await startFromPicks(code, ["tue-18", "thu-19"], h.deps)).ok).toBe(true);

    const first = await viewLink(code, h.deps);
    expect(first.ok && first.value.phase === "plan" && first.value.plan.state).toBe("negotiating");
    expect(await answerFromPage(code, "accept", h.deps)).toMatchObject({ ok: false, status: 409, code: "not_waiting_for_you" });

    await h.run();
    const agreed = await viewLink(code, h.deps);
    expect(agreed.ok && agreed.value.phase === "plan" && agreed.value.plan.state).toBe("awaiting_you");
    expect(agreed.ok && agreed.value.phase === "plan" && agreed.value.plan.whatsapp_draft).toBe("Hey Mochi, shawarma Thursday at 7? Want to go?");

    expect(await answerFromPage(code, "maybe", h.deps)).toMatchObject({ ok: false, status: 400 });
    const approved = await answerFromPage(code, "accept", h.deps);
    expect(approved.ok && approved.value.state).toBe("confirmed");
    const done = await viewLink(code, h.deps);
    expect(done.ok && done.value.phase === "plan" && done.value.plan.decisions).toEqual({ you: "accepted", mochi: "accepted" });
  });

  it("Decline closes the plan and Mochi is never asked", async () => {
    let asked = 0;
    const h = harness({ mochi: async () => (asked += 1, "accept") });
    const code = await mint(h);
    await startFromPicks(code, ["sat-11"], h.deps);
    await h.run();
    const declined = await answerFromPage(code, "decline", h.deps);
    expect(declined.ok && declined.value.state).toBe("dropped");
    expect(asked).toBe(0);
  });

  it("is not reachable through check_plan before it has a plan, and says so", async () => {
    const h = harness();
    const code = await mint(h);
    expect(await checkPlan({ planId: roomKeyOfCode(code) }, h.deps)).toMatchObject({ ok: false, status: 409, code: "not_started" });
  });

  it("leaves the demo store, and its file, exactly as it was", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "muse-keyless-demo-"));
    vi.stubEnv("STORE", "json");
    vi.stubEnv("STORE_PATH", path.join(dir, "store.json"));
    const shared = globalThis as typeof globalThis & { __museStore?: unknown };
    delete shared.__museStore;
    const demo = await getStore();
    await demo.replaceAll(recordedSnapshot());
    const before = JSON.stringify(await demo.snapshot());
    const fileBefore = readFileSync(path.join(dir, "store.json"), "utf8");
    const mtimeBefore = statSync(path.join(dir, "store.json")).mtimeMs;

    const h = harness();
    const code = await mint(h);
    await startFromPicks(code, ["tue-18"], h.deps);
    await h.run();
    await answerFromPage(code, "accept", h.deps);
    await readJudgeRoom(code, h.deps);

    expect(JSON.stringify(await (await getStore()).snapshot())).toBe(before);
    expect(readFileSync(path.join(dir, "store.json"), "utf8")).toBe(fileBefore);
    expect(statSync(path.join(dir, "store.json")).mtimeMs).toBe(mtimeBefore);
    expect(readdirSync(dir)).toEqual(["store.json"]);
    delete shared.__museStore;
  });
});

describe("the table screen reads a judge's room", () => {
  it("returns the room's UI snapshot and a stable ETag that changes when the room does, and null for anything else", async () => {
    const h = harness();
    const code = await mint(h);
    const empty = await readJudgeRoom(code, h.deps);
    expect(empty?.etag).toMatch(/^judge-[0-9a-f]{16}$/);
    expect((await readJudgeRoom(code, h.deps))?.etag).toBe(empty?.etag);
    expect(empty?.ui).toHaveProperty("messages");

    await startFromPicks(code, ["tue-18"], h.deps);
    await h.run();
    const later = await readJudgeRoom(code, h.deps);
    expect(later?.etag).not.toBe(empty?.etag);
    expect(later?.ui.messages.length).toBe(3);

    expect(await readJudgeRoom("demo", h.deps)).toBeNull();
    expect(await readJudgeRoom("abc123", h.deps)).toBeNull();
    expect(await readJudgeRoom(code.toUpperCase(), h.deps)).toBeNull();
    expect(await readJudgeRoom("zzzzzzz", h.deps)).toBeNull();
    h.advance(ROOM_TTL_MS + 1000);
    expect(await readJudgeRoom(code, h.deps)).toBeNull();
  });

  it("is closed with the station: null when the judge key is unset", async () => {
    const h = harness();
    const code = await mint(h);
    vi.stubEnv("MCP_TOKEN_JUDGE", "");
    expect(await readJudgeRoom(code, h.deps)).toBeNull();
  });

  it("answers /api/state with the judge's room for its code and with the demo room for everything else", async () => {
    const repo = memoryRoomRepo();
    const minted = await mintCode({ repo, now: () => Date.now(), schedule: () => {} });
    const code = minted.ok ? minted.value.code : "";
    const json = async (query: string, headers: Record<string, string> = {}) => stateGet(new Request(`https://muse-friends.test/api/state${query}`, { headers }));

    expect(await (await json("")).json()).toEqual({ marker: "demo room" });
    expect(await (await json("?room=demo")).json()).toEqual({ marker: "demo room" });
    // A phone's room id is no longer the demo room: it answers with that room's own (here empty) stage.
    expect(await (await json("?room=abc123")).json()).not.toHaveProperty("marker");
    expect(await (await json("?room=Not-Valid")).json()).toEqual({ marker: "demo room" });

    const judge = await json(`?room=${code}`);
    expect(judge.status).toBe(200);
    expect(await judge.json()).not.toHaveProperty("marker");
    const etag = judge.headers.get("etag")!;
    expect(etag).toMatch(/^"judge-/);
    expect((await json(`?room=${code}`, { "if-none-match": etag })).status).toBe(304);
  });
});

describe("the pages", () => {
  const get = (code: string) => pageGet(new Request(`https://muse-friends.test/j/${code}`), { params: Promise.resolve({ code }) });
  const form = (url: string, fields: Array<[string, string]>) => {
    const body = new URLSearchParams(fields);
    return new Request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body });
  };

  async function mintViaRoute(): Promise<string> {
    const response = await connectCodePost();
    expect(response.status).toBe(303);
    const code = new URL(response.headers.get("location")!, "https://muse-friends.test").searchParams.get("code");
    expect(code).toMatch(/^[a-hj-km-np-z2-9]{7}$/);
    return code!;
  }

  it("GET shows the intro, native checkboxes named slot, and a native submit, with no script and no cookie", async () => {
    const code = await mintViaRoute();
    const response = await get(code);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("set-cookie")).toBeNull();
    const html = await response.text();
    expect(html).toContain("Optional and unofficial");
    expect(html).toContain("not a shipped Muse feature");
    expect(html).toContain(`<form method="post" action="/j/${code}/start">`);
    expect((html.match(/<input type="checkbox" id="slot-[a-z0-9-]+" name="slot"/g) ?? []).length).toBe(6);
    expect(html).toContain('aria-label="Tue Oct 27, 6 to 8pm"');
    expect(html).toContain("Tue Oct 27, 6 to 8pm");
    expect(html).toContain("Send my picks");
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/onclick|onchange|onsubmit/i);
    expect(html).not.toContain("\u2014");
  });

  it("is closed (404) when the judge key is unset, and 404 or 410 for a code that is not valid or has expired", async () => {
    const code = await mintViaRoute();
    expect((await get("zzzzzzz")).status).toBe(404);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + ROOM_TTL_MS + 5000);
    const expired = await get(code);
    expect(expired.status).toBe(410);
    expect(await expired.text()).toContain("expired");
    vi.useRealTimers();
    vi.stubEnv("MCP_TOKEN_JUDGE", "");
    expect((await get(code)).status).toBe(404);
    expect((await startPost(form(`https://muse-friends.test/j/${code}/start`, [["slot", "tue-18"]]), { params: Promise.resolve({ code }) })).status).toBe(404);
    expect((await answerPost(form(`https://muse-friends.test/j/${code}/answer`, [["decision", "accept"]]), { params: Promise.resolve({ code }) })).status).toBe(404);
    expect((await connectCodePost()).headers.get("location")).toBe("/connect");
  });

  it("POST with no picks is refused with the page and a reason; an unknown box is refused; neither starts anything", async () => {
    const code = await mintViaRoute();
    const params = { params: Promise.resolve({ code }) };
    const none = await startPost(form(`https://muse-friends.test/j/${code}/start`, []), params);
    expect(none.status).toBe(400);
    const noneHtml = await none.text();
    expect(noneHtml).toContain("Tick at least one time");
    expect(noneHtml).toContain('name="slot"');
    const odd = await startPost(form(`https://muse-friends.test/j/${code}/start`, [["slot", "<script>alert(1)</script>"]]), params);
    expect(odd.status).toBe(400);
    expect(await odd.text()).not.toContain("<script>alert");
    const decoy = await startPost(form(`https://muse-friends.test/j/${code}/start`, [["slot", "wed-18"]]), params);
    expect(decoy.status).toBe(422);
    expect(scheduled).toHaveLength(0);
  });

  it("POST with a tick starts the plan, redirects with a 303 to the page, and the page then says the plan started", async () => {
    const code = await mintViaRoute();
    const params = { params: Promise.resolve({ code }) };
    const sent = await startPost(form(`https://muse-friends.test/j/${code}/start`, [["slot", "tue-18"], ["slot", "thu-19"]]), params);
    expect(sent.status).toBe(303);
    expect(sent.headers.get("location")).toBe(`/j/${code}`);
    expect(scheduled).toHaveLength(1);

    const html = await (await get(code)).text();
    expect(html).toContain("Plan started");
    expect(html).toContain("Come back to this page in a minute");
    expect(html).not.toContain('name="decision"');

    // A second send for the same code goes back to the page and starts nothing more.
    const again = await startPost(form(`https://muse-friends.test/j/${code}/start`, [["slot", "sat-19"]]), params);
    expect(again.status).toBe(303);
    expect(scheduled).toHaveLength(1);

    // Approve is refused until they agree, and the browser is just sent back to the page.
    const early = await answerPost(form(`https://muse-friends.test/j/${code}/answer`, [["decision", "accept"]]), params);
    expect(early.status).toBe(303);
  });

  it("shows native Approve and Decline buttons when the agents agree, and a confirmation line after", () => {
    const base = { planId: "j_x", plan_state: "awaiting_humans" as const, activity: { title: "Shawarma Point", place: "E 6th St" }, messages: [{ seq: 1, from: "Sprout", to: "Mochi", type: "intent", note: "<b>hi</b>", windows: [], policy: { shared: [], withheld: [], windows_dropped: 0 } }], agreed_window: { start: "2026-10-29T19:00:00-05:00", end: "2026-10-29T21:00:00-05:00", label: "Thu 7 to 9pm" }, decisions: { you: "pending", mochi: "pending" }, whatsapp_draft: "Hey Mochi, shawarma at 7?", whatsapp_link: null, dropped_reason: null, next: "" };
    const waiting = planPage("abcd234", { ...base, state: "awaiting_you" }, 90);
    expect(waiting).toContain('<form method="post" action="/j/abcd234/answer">');
    expect(waiting).toContain('name="decision" value="accept">Approve</button>');
    expect(waiting).toContain('name="decision" value="decline" class="secondary">Decline</button>');
    expect(waiting).toContain("Thu 7 to 9pm");
    expect(waiting).toContain("Hey Mochi, shawarma at 7?");
    expect(waiting).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(waiting).not.toContain("<b>hi</b>");
    expect(waiting).not.toMatch(/<script/i);

    const confirmed = planPage("abcd234", { ...base, state: "confirmed", plan_state: "confirmed", whatsapp_link: "https://wa.me/?text=Hey", decisions: { you: "accepted", mochi: "accepted" } }, 80);
    expect(confirmed).toContain("Confirmed.");
    expect(confirmed).not.toContain('name="decision"');
    const declined = planPage("abcd234", { ...base, state: "dropped", plan_state: "dropped", decisions: { you: "declined", mochi: "pending" } }, 80);
    expect(declined).toContain("Declined.");
    const negotiating = planPage("abcd234", { ...base, state: "negotiating", plan_state: "negotiating" }, 80);
    expect(negotiating).toContain('http-equiv="refresh"');
    expect(waiting).not.toContain('http-equiv="refresh"');
    for (const html of [waiting, confirmed, declined, negotiating]) expect(html).not.toContain("\u2014");
    expect(linkPage({ phase: "pick", code: "abcd234", candidates: [{ id: "tue-18", label: "Tue Oct 27, 6 to 8pm" }], minutesLeft: 1 })).toContain("1 more minute and");
  });

  it("the /connect button mints a code and redirects to /connect?code=..., and the code route needs the judge key", async () => {
    const response = await codeGet(new Request("https://muse-friends.test/api/connector/code"));
    expect(response.status).toBe(401);
    expect((await codeGet(new Request("https://muse-friends.test/api/connector/code", { headers: { authorization: `Bearer ${"a".repeat(48)}` } }))).status).toBe(403);
    const ok = await codeGet(new Request("https://muse-friends.test/api/connector/code", { headers: { authorization: `Bearer ${judgeKey}` } }));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.error).toBeNull();
    expect(Object.keys(body.data).sort()).toEqual(["code", "expires_in_minutes", "link", "sentence", "table_screen"]);
    expect(body.data.link).toBe(`https://muse-friends.test/j/${body.data.code}`);
    expect(body.data.table_screen).toBe(`https://muse-friends.test/?room=${body.data.code}`);
    expect(body.data.sentence).toBe(`Open https://muse-friends.test/j/${body.data.code}, check which proposed times I'm free for, pick the ones that work, and show me the plan before approving`);
    vi.stubEnv("MCP_TOKEN_JUDGE", "");
    expect((await codeGet(new Request("https://muse-friends.test/api/connector/code", { headers: { authorization: `Bearer ${judgeKey}` } }))).status).toBe(401);
  });

  it("no source under app/j or app/api/connector names the demo store's factory", () => {
    const roots = ["app/j", "app/api/connector"].map((root) => path.join(process.cwd(), root));
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) files.push(full);
      }
    };
    for (const root of roots) walk(root);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/getStore/);
  });
});
