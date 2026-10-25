import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as getClockless } from "@/app/api/state/route";
import { POST as postClock } from "@/app/api/clock/route";
import { POST as postControls } from "@/app/api/controls/route";
import { GET as getDraft, POST as postDraft } from "@/app/api/plans/[id]/draft/route";
import { POST as postBusy } from "@/app/api/plans/[id]/busy/route";
import { POST as postDecision } from "@/app/api/plans/[id]/decision/route";
import { GET as getHold } from "@/app/api/plans/[id]/hold.ics/route";
import { POST as postFriend } from "@/app/api/simulated-friend/route";
import { GET as getReplay } from "@/app/api/replay/route";
import { resetRunBudget, runBudget } from "@/lib/agent/caps";
import { ownCalendar } from "@/lib/agent/calendar";
import { SHAWARMA_PLAN_ID, recordedSnapshot } from "@/lib/seed/fixtures";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import { JsonStore } from "@/lib/store/json";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";

// The routes run against a real JsonStore, the same way the app does.
let store: JsonStore;
beforeEach(async () => {
  resetRunBudget();
  store = new JsonStore(null);
  await store.replaceAll(recordedSnapshot());
  (globalThis as { __museStore?: Promise<JsonStore> }).__museStore = Promise.resolve(store);
});
afterEach(() => {
  delete (globalThis as { __museStore?: unknown }).__museStore;
  delete process.env.MAX_LIVE_RUNS_PER_ROOM_PER_HOUR;
  resetRunBudget();
  removeFakeModel();
});

const json = (body: unknown) => new Request("http://localhost/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id = SHAWARMA_PLAN_ID) => ({ params: Promise.resolve({ id }) }) as never;

async function answer(response: Response) {
  return { status: response.status, body: (await response.json()) as { data: unknown; error: { message: string } | null } };
}

describe("state", () => {
  it("answers a matching ETag with 304 and no body", async () => {
    const first = await getClockless(new Request("http://localhost/api/state"));
    const etag = first.headers.get("etag")!;
    expect(first.status).toBe(200);
    const again = await getClockless(new Request("http://localhost/api/state", { headers: { "if-none-match": etag } }));
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
  });

  it("changes the ETag when anything changes", async () => {
    const before = (await getClockless(new Request("http://localhost/api/state"))).headers.get("etag");
    await postDecision(json({ role: "a", choice: "accept" }), ctx());
    const after = (await getClockless(new Request("http://localhost/api/state"))).headers.get("etag");
    expect(after).not.toBe(before);
  });
});

describe("decision, handoff, hold, clock", () => {
  it("maps the lifecycle's answers to statuses", async () => {
    expect((await answer(await postDecision(json({ role: "a", choice: "accept" }), ctx()))).status).toBe(200);
    expect((await answer(await postDecision(json({ role: "a", choice: "accept" }), ctx()))).status).toBe(409);
    expect((await answer(await postDecision(json({ role: "b", choice: "accept" }), ctx("plan_missing")))).status).toBe(404);
    expect((await answer(await postDecision(json({ role: "x" }), ctx()))).status).toBe(400);
  });

  it("walks the journey the phones drive and serves a real calendar file", async () => {
    await postDecision(json({ role: "a", choice: "accept" }), ctx());
    await postDecision(json({ role: "b", choice: "accept" }), ctx());
    const draft = await answer(await getDraft(new Request("http://localhost"), ctx()));
    expect((draft.body.data as { whatsAppUrl: string }).whatsAppUrl).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect((await answer(await postDraft(json({ role: "a", via: "whatsapp" }), ctx()))).status).toBe(200);

    const hold = await getHold(new Request("http://localhost/api/plans/x/hold.ics?role=b"), ctx());
    const ics = await hold.text();
    expect(hold.status).toBe(200);
    expect(hold.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(hold.headers.get("content-disposition")).toBe('attachment; filename="hold.ics"');
    expect(ics).toContain("DTSTART:20261027T230000Z");
    expect(ics).toContain("SUMMARY:Shawarma Point with Sprout");
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);

    expect((await answer(await postClock(json({ action: "advance" })))).status).toBe(200);
    expect((await answer(await postClock(json({ action: "advance" })))).status).toBe(200);
    expect((await answer(await postClock(json({ action: "advance" })))).status).toBe(409);
    expect((await store.getPlan(SHAWARMA_PLAN_ID))?.state).toBe("followed_up");
  });

  it("refuses the clock before both people said yes", async () => {
    expect((await answer(await postClock(json({ action: "advance" })))).status).toBe(409);
  });
});

describe("controls", () => {
  it("keeps Free times and the Off tier on, and refuses side a", async () => {
    expect((await answer(await postControls(json({ type: "privacy", side: "b", category: "availability", on: false })))).status).toBe(409);
    expect((await answer(await postControls(json({ type: "privacy", side: "b", tier: "off" })))).status).toBe(409);
    expect((await answer(await postControls(json({ type: "privacy", side: "a", category: "food", on: false })))).status).toBe(400);
  });

  it("flips location and replays the propose in place", async () => {
    const result = await answer(await postControls(json({ type: "privacy", side: "b", category: "location", on: false })));
    expect(result.status).toBe(200);
    expect((await store.listRedactions()).some((redaction) => redaction.removed.includes("location"))).toBe(true);
  });

  it("switches to the simulated friend, which starts the room over", async () => {
    const result = await answer(await postControls(json({ type: "simulated_friend", on: true })));
    expect(result.status).toBe(200);
    expect((await store.getRoom()).simulatedFriend).toBe(true);
    expect(await store.listPlans()).toEqual([]);
  });

  it("resets the room", async () => {
    await postControls(json({ type: "reset" }));
    expect(await store.listPlans()).toEqual([]);
  });
});

describe("the simulated friend's answer", () => {
  it("refuses when the room has a real second person", async () => {
    expect((await answer(await postFriend(json({ planId: SHAWARMA_PLAN_ID })))).status).toBe(409);
  });

  it("answers once with a real model call, and a second ask finds nothing waiting", async () => {
    await store.putRoom({ ...(await store.getRoom()), simulatedFriend: true });
    const model = installFakeModel([{ calls: [{ name: "answer_card", args: { choice: "accept" } }] }]);
    const first = await answer(await postFriend(json({ planId: SHAWARMA_PLAN_ID })));
    expect(first.status).toBe(200);
    expect((await store.getPlan(SHAWARMA_PLAN_ID))?.decisions).toMatchObject({ lisa: "accepted" });
    expect(model.calls).toHaveLength(1);
    expect((await answer(await postFriend(json({ planId: SHAWARMA_PLAN_ID })))).status).toBe(409);
  }, 15_000);

  it("answers 502 and records nothing when the model does not answer", async () => {
    await store.putRoom({ ...(await store.getRoom()), simulatedFriend: true });
    installFakeModel([{ text: "sure" }, { text: "sure" }]);
    expect((await answer(await postFriend(json({ planId: SHAWARMA_PLAN_ID })))).status).toBe(502);
    expect((await store.getPlan(SHAWARMA_PLAN_ID))?.decisions.lisa).toBe("pending");
  }, 15_000);
});

describe("replay", () => {
  it("serves every frame of the best run and never labels a recording Live", async () => {
    const result = await answer(await getReplay());
    const replay = result.body.data as { frames: Array<{ snapshot: { mode: string } }>; source: string };
    expect(result.status).toBe(200);
    expect(replay.frames.length).toBeGreaterThan(8);
    expect(replay.frames.every((frame) => frame.snapshot.mode === "replay")).toBe(true);
  });
});

describe("that time doesn't work for me", () => {
  it("marks the plan's window busy for that person, so the agents' calendar includes it", async () => {
    const plan = (await store.getPlan(SHAWARMA_PLAN_ID))!;
    const result = await answer(await postBusy(json({ role: "a" }), ctx()));
    expect(result.status).toBe(200);
    const aaron = await ownCalendar(store, "aaron");
    const block = aaron.find((event) => event.title === "Busy");
    expect(block).toMatchObject({ private: true });
    expect(Date.parse(block!.start)).toBe(Date.parse(plan.window!.start));
    expect(Date.parse(block!.end)).toBe(Date.parse(plan.window!.end));
    expect((await ownCalendar(store, "lisa")).some((event) => event.title === "Busy")).toBe(false);
  });

  it("shows up on the timeline as a row of its own", async () => {
    await postBusy(json({ role: "b" }), ctx());
    const { notes } = toUiSnapshot(await store.snapshot(), { mode: "live" });
    expect(notes.map((note) => note.kind)).toContain("busy_added");
    expect(notes.find((note) => note.kind === "busy_added")?.text).toContain("marked");
  });

  it("only while the plan is waiting on people, and for a plan that exists", async () => {
    expect((await answer(await postBusy(json({ role: "a" }), ctx("plan_missing")))).status).toBe(404);
    expect((await answer(await postBusy(json({ role: "x" }), ctx()))).status).toBe(400);
    await postDecision(json({ role: "a", choice: "accept" }), ctx());
    await postDecision(json({ role: "b", choice: "accept" }), ctx());
    expect((await answer(await postBusy(json({ role: "a" }), ctx()))).status).toBe(409);
    expect((await ownCalendar(store, "aaron")).some((event) => event.title === "Busy")).toBe(false);
  });
});

describe("the live-run caps", () => {
  it("counts the simulated friend's model call against the same budget", async () => {
    await store.putRoom({ ...(await store.getRoom()), simulatedFriend: true });
    installFakeModel([{ calls: [{ name: "answer_card", args: { choice: "accept" } }] }]);
    expect(runBudget().room.used).toBe(0);
    await postFriend(json({ planId: SHAWARMA_PLAN_ID }));
    expect(runBudget().room.used).toBe(1);
    expect(runBudget().global.used).toBe(1);
  }, 15_000);

  it("past the cap she does not make a model call: 429 paused with the text and the budget, and her card stays pending", async () => {
    process.env.MAX_LIVE_RUNS_PER_ROOM_PER_HOUR = "0";
    await store.putRoom({ ...(await store.getRoom()), simulatedFriend: true });
    const model = installFakeModel([]);
    const response = await postFriend(json({ planId: SHAWARMA_PLAN_ID }));
    const body = (await response.json()) as { paused: boolean; text: string; reason: string; budget: { paused: boolean } };
    expect(response.status).toBe(429);
    expect(body).toMatchObject({ paused: true, text: "Live runs paused, playing a recording", reason: "room", budget: { paused: true } });
    expect(response.headers.get("retry-after")).toBeTruthy();
    expect(model.calls).toHaveLength(0);
    expect((await store.getPlan(SHAWARMA_PLAN_ID))?.decisions.lisa).toBe("pending");
  }, 15_000);

  it("puts the budget on the live snapshot for the JSON drawer, and none on a recording", async () => {
    const live = (await (await getClockless(new Request("http://localhost/api/state"))).json()) as { budget: { room: { limit: number }; paused: boolean } | null };
    expect(live.budget).toMatchObject({ paused: false, room: { limit: 30 } });
    const replay = (await (await getReplay()).json()) as { data: { frames: Array<{ snapshot: { budget: unknown } }> } };
    expect(replay.data.frames.every((frame) => frame.snapshot.budget === null)).toBe(true);
  });
});
