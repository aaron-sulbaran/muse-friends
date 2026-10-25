import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRunBudget, runBudget } from "@/lib/agent/caps";
import { startFollowUp } from "@/lib/agent/followup";
import { runFollowUpTurn, runInboxTurn } from "@/lib/agent/runtime";
import { followUpTurnInput } from "@/lib/agent/prompts";
import { agentToken, localDeliver } from "@/lib/agent/wire";
import { REFUSAL_TEXT, enforceSharePolicy, projectShared, startGate } from "@/lib/policy";
import {
  AgentMessage,
  CATEGORIES,
  Plan,
  SHARE_TIERS,
  SharePolicy,
  TIER_DEFAULTS,
  categoriesInMessage,
  isCategoryAllowed,
} from "@/lib/protocol";
import { CONTACTS, Contact, getContact, isMutual } from "@/lib/seed/contacts";
import { PERSONAS } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";
import { installWireShim } from "./helpers/wire";

const scheduled: Array<() => unknown> = [];
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (callback: () => unknown) => void scheduled.push(callback) }));

const TUE = { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" };
const policy = (categories = {}) => SharePolicy.parse({ owner: "aaron", friend: "lisa", tier: "acquaintance", categories });
const jules = getContact("jules")!;
const riley = getContact("riley")!;

let uninstallWire: (() => void) | undefined;
let store: JsonStore;
beforeEach(() => {
  scheduled.length = 0;
  store = new JsonStore(null);
  process.env.STORE_PATH = path.join(mkdtempSync(path.join(tmpdir(), "muse-followup-")), "store.json");
  (globalThis as { __museStore?: unknown }).__museStore = Promise.resolve(store);
});
afterEach(() => {
  uninstallWire?.();
  uninstallWire = undefined;
  removeFakeModel();
  (globalThis as { __museStore?: unknown }).__museStore = undefined;
});

describe("the acquaintance tier", () => {
  it("is a tier value, and shares interests and food and free windows but never events or location", () => {
    expect(SHARE_TIERS).toContain("acquaintance");
    expect(TIER_DEFAULTS.acquaintance).toEqual({ food: true, events: false, availability: true, location: false, interests: true });
    const allowed = CATEGORIES.filter((category) => isCategoryAllowed(policy(), category));
    expect(allowed).toEqual(["food", "availability", "interests"]);
    // Shares less than a friend does.
    expect(CATEGORIES.filter((category) => isCategoryAllowed({ ...policy(), tier: "friend" }, category)).length).toBeGreaterThan(allowed.length);
  });

  it("can never be talked into sharing location, whatever the per-category switch says", () => {
    expect(isCategoryAllowed(policy({ location: true }), "location")).toBe(false);
    expect(isCategoryAllowed(policy({ location: true, events: true }), "events")).toBe(true);
  });

  it("projects only food and interests from the sender's own data, whatever the model asks for", () => {
    const shared = projectShared(PERSONAS.aaron, ["food", "events", "location", "interests"], policy());
    expect(Object.keys(shared ?? {}).sort()).toEqual(["food", "interests"]);
  });

  it("strips a place and a location list that a bug let through", () => {
    const message = AgentMessage.parse({
      id: "m1",
      contextId: "ctx_1",
      seq: 1,
      from: "aaron",
      to: "lisa",
      type: "intent",
      state: "working",
      activity: { kind: "food", title: "Coffee", place: "Mueller" },
      windows: [TUE],
      reason: "interest_match",
      shared: { food: ["ramen"], location: ["East Austin"] },
      at: "2026-10-25T14:00:00-05:00",
    });
    const outcome = enforceSharePolicy({ message, policy: policy({ location: true }), sender: PERSONAS.aaron });
    expect(outcome.message.activity?.place).toBeUndefined();
    expect(outcome.message.shared).toEqual({ food: ["ramen"] });
    expect(categoriesInMessage(outcome.message)).not.toContain("location");
    expect(outcome.removed).toEqual(["location"]);
  });
});

describe("the seeded contacts", () => {
  it("are fictional, in the contact shape Lane B's picker reads, one mutual and one not", () => {
    for (const contact of CONTACTS) expect(Contact.safeParse(contact).success).toBe(true);
    expect(CONTACTS.map((contact) => contact.id)).toEqual(["jules", "riley"]);
    expect(CONTACTS.every((contact) => contact.tier === "acquaintance")).toBe(true);
    expect(isMutual(jules)).toBe(true);
    expect(jules.howYouMet.toLowerCase()).toContain("concert last week");
    expect(isMutual(riley)).toBe(false);
    expect(riley).toMatchObject({ followsYou: true, youFollow: false });
  });
});

describe("the start gate: no mutual follow, no thread", () => {
  it("passes a mutual follow and refuses every other combination", () => {
    expect(startGate({ youFollow: true, followsYou: true })).toEqual({ ok: true });
    for (const contact of [{ youFollow: false, followsYou: true }, { youFollow: true, followsYou: false }, { youFollow: false, followsYou: false }]) {
      expect(startGate(contact)).toEqual({ ok: false, reason: "not_mutual" });
    }
  });

  it("refuses the non-mutual contact with a logged refusal and no thread", async () => {
    const result = await startFollowUp(store, { target: "riley" });
    expect(result).toMatchObject({ ok: true, started: false, reason: "not_mutual", text: REFUSAL_TEXT.not_mutual("Riley") });

    const [plan] = await store.listPlans();
    expect(plan).toMatchObject({ state: "dropped", dropReason: "policy_blocked", target: "riley" });
    expect(Plan.safeParse(plan).success).toBe(true);
    expect(plan.history.map((entry) => [entry.state, entry.note])).toEqual([["detected", "Follow-up requested"], ["dropped", "not_mutual"]]);
    expect(await store.listThreads()).toHaveLength(0);
    expect(await store.listMessages()).toHaveLength(0);

    const events = await store.listEvents();
    expect(events.map((event) => [event.kind, event.actor])).toEqual([["signal_received", "human"], ["plan_state", "system"]]);
    expect(events[1].text).toBe("No thread opened: you and Riley do not follow each other.");
    // Sharing settings were left alone: nothing was opened up for someone who is not a mutual.
    expect((await store.getPolicy("aaron", "lisa"))?.tier).toBe("close");
  });

  it("lets the mutual contact through, sets the acquaintance tier both ways, and records the person's choice", async () => {
    const result = await startFollowUp(store, { target: "jules" });
    expect(result).toMatchObject({ ok: true, started: true });
    const [plan] = await store.listPlans();
    expect(plan).toMatchObject({ state: "detected", target: "jules", initiator: "aaron", participants: ["aaron", "lisa"] });
    expect((await store.getPolicy("aaron", "lisa"))?.tier).toBe("acquaintance");
    expect((await store.getPolicy("lisa", "aaron"))?.tier).toBe("acquaintance");
    const events = await store.listEvents();
    expect(events.map((event) => event.kind)).toEqual(["signal_received", "policy_changed"]);
    expect(events[1].text).toBe("Sharing with Jules is at the acquaintance level: interests, food, and free times only, never location");
  });

  it("does not know a contact the person did not name", async () => {
    expect(await startFollowUp(store, { target: "somebody" })).toMatchObject({ ok: false, status: 404 });
    expect(await store.listPlans()).toHaveLength(0);
  });

  it("the turn itself will not run for a non-mutual contact, even called directly", async () => {
    const model = installFakeModel([]);
    const result = await runFollowUpTurn({ store, agent: "aaron", contact: riley, contextId: "ctx_direct" });
    expect(result.status).toBe("completed");
    expect(model.calls).toHaveLength(0);
    expect(await store.listMessages()).toHaveLength(0);
  });

  it("and the send path refuses to open a thread for one too", async () => {
    installFakeModel([{ calls: [{ name: "send_to_friend_agent", args: { friend: "lisa", type: "intent", reason: "interest_match" } }] }, { text: "ok" }]);
    const { buildTools } = await import("@/lib/agent/tools");
    const { handlers } = buildTools({ agent: "aaron", store, contextId: "ctx_x", target: "riley", windowRepairs: { used: 0 } });
    const result = (await handlers.send_to_friend_agent({ friend: "lisa", type: "intent", reason: "interest_match" })) as { error?: string };
    expect(result.error).toMatch(/does not follow you back/);
    expect(await store.listThreads()).toHaveLength(0);
  });
});

describe("the signals route", () => {
  const post = async (body: unknown) => {
    const { POST } = await import("@/app/api/signals/route");
    return POST(new Request("http://localhost:3001/api/signals", { method: "POST", body: JSON.stringify(body) }));
  };

  it("answers 409 not_mutual for the non-mutual contact, starts nothing, and calls no model", async () => {
    const model = installFakeModel([]);
    const response = await post({ scenario: "follow_up", target: "riley" });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ refused: true, reason: "not_mutual", contactId: "riley", text: "No thread opened: you and Riley do not follow each other." });
    expect(scheduled).toHaveLength(0);
    expect(model.calls).toHaveLength(0);
    expect(await store.listThreads()).toHaveLength(0);
  });

  it("answers 202 for the mutual contact and schedules the opening turn", async () => {
    const response = await post({ scenario: "follow_up", target: "jules" });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ contactId: "jules", planId: expect.any(String), contextId: expect.any(String) });
    expect(scheduled).toHaveLength(1);
  });

  it("needs the person to name the contact: no target, an unknown target, or a stray field is refused", async () => {
    expect((await post({ scenario: "follow_up" })).status).toBe(400);
    expect((await post({ target: "jules" })).status).toBe(400);
    expect((await post({ scenario: "follow_up", target: "somebody" })).status).toBe(404);
    expect(scheduled).toHaveLength(0);
  });

  it("leaves the reel scenario as it was", async () => {
    expect((await post({})).status).toBe(202);
    expect((await store.listSignals()).length).toBe(1);
  });

  it("counts refusals and follow-ups against the room's hourly run cap, but gives the slot back for an unknown contact", async () => {
    resetRunBudget();
    process.env.MAX_LIVE_RUNS_PER_ROOM_PER_HOUR = "2";
    try {
      expect((await post({ scenario: "follow_up", target: "somebody" })).status).toBe(404);
      expect(runBudget().room.used).toBe(0);
      expect((await post({ scenario: "follow_up", target: "riley" })).status).toBe(409);
      expect((await post({ scenario: "follow_up", target: "riley" })).status).toBe(409);
      const paused = await post({ scenario: "follow_up", target: "riley" });
      expect(paused.status).toBe(429);
      expect(await paused.json()).toMatchObject({ paused: true, text: "Live runs paused, playing a recording" });
    } finally {
      delete process.env.MAX_LIVE_RUNS_PER_ROOM_PER_HOUR;
      resetRunBudget();
    }
  });
});

describe("an acquaintance-tier negotiation never shares location", () => {
  it("builds the brief from the person's choice, offers no signal tools, and keeps the contact's name", async () => {
    const model = installFakeModel([{ calls: [{ name: "get_my_calendar", args: { start: "2026-10-26", end: "2026-11-01" } }] }, { calls: [{ name: "send_to_friend_agent", args: { friend: "lisa", type: "intent", reason: "interest_match", activity: { kind: "food", title: "Coffee" }, windows: [TUE] } }] }]);
    const started = await startFollowUp(store, { target: "jules" });
    if (!started.ok || !started.started) throw new Error("expected a start");
    await runFollowUpTurn({ store, agent: "aaron", contact: jules, contextId: started.contextId, deliver: localDeliver(store, "aaron") });
    const toolNames = (model.calls[0].tools as Array<{ name: string }>).map((tool) => tool.name);
    expect(toolNames).toEqual(["get_my_calendar", "get_interests", "send_to_friend_agent"]);
    expect(JSON.stringify(model.calls[0].input)).toContain("follow up with Jules");
    expect(followUpTurnInput("aaron", jules, Date.parse("2026-10-25T14:00:00-05:00"))).toContain("acquaintances, not close friends");
    expect(await store.listThreads()).toHaveLength(1);
  });

  it("even when both agents ask for location and name a place, nothing location-like crosses", async () => {
    const started = await startFollowUp(store, { target: "jules" });
    if (!started.ok || !started.started) throw new Error("expected a start");
    const ask = (friend: string, type: string, extra = {}) => ({
      name: "send_to_friend_agent",
      args: { friend, type, reason: "interest_match", activity: { kind: "food", title: "Coffee", place: "Mueller" }, windows: [TUE], share: ["location", "events", "food", "interests"], ...extra },
    });
    installFakeModel([
      { calls: [ask("lisa", "intent")] },
      { calls: [ask("aaron", "accept")] },
      { calls: [ask("lisa", "accept")] },
    ]);
    await runFollowUpTurn({ store, agent: "aaron", contact: jules, contextId: started.contextId, deliver: localDeliver(store, "aaron") });
    await runInboxTurn({ store, agent: "lisa", contextId: started.contextId, deliver: localDeliver(store, "lisa") });
    await runInboxTurn({ store, agent: "aaron", contextId: started.contextId, deliver: localDeliver(store, "aaron") });

    const records = await store.listMessages(started.contextId);
    expect(records).toHaveLength(3);
    for (const record of records) {
      expect(categoriesInMessage(record.message)).not.toContain("location");
      expect(record.message.activity?.place).toBeUndefined();
      expect(record.message.shared?.location).toBeUndefined();
      expect(record.message.shared?.events).toBeUndefined();
      expect(record.stamp.passed).not.toContain("location");
    }
    // The place the model wrote was held back and logged by category, not value.
    expect(records[0].stamp.removed).toContain("location");
    const redactions = await store.listRedactions(started.contextId);
    expect(redactions.length).toBeGreaterThan(0);
    expect(JSON.stringify(redactions)).not.toContain("Mueller");
    expect((await store.getPlanByContext(started.contextId))?.state).toBe("awaiting_humans");
  });

  it("the inbox refuses a forged message carrying location from an acquaintance-tier sender", async () => {
    const started = await startFollowUp(store, { target: "jules" });
    if (!started.ok || !started.started) throw new Error("expected a start");
    uninstallWire = installWireShim();
    const forged = AgentMessage.parse({
      id: "forged_1",
      contextId: started.contextId,
      seq: 1,
      from: "aaron",
      to: "lisa",
      type: "intent",
      state: "working",
      activity: { kind: "food", title: "Coffee", place: "Mueller" },
      windows: [TUE],
      reason: "interest_match",
      at: "2026-10-25T14:00:08-05:00",
    });
    const { POST } = await import("@/app/api/agents/[id]/inbox/route");
    const response = await POST(
      new Request("http://localhost:3001/api/agents/lisa/inbox", {
        method: "POST",
        headers: { authorization: `Bearer ${agentToken("aaron")}`, "content-type": "application/json" },
        body: JSON.stringify({ message: forged, stamp: { passed: ["availability", "location"], removed: [], windowsDropped: 0 }, redaction: null }),
      }),
      { params: Promise.resolve({ id: "lisa" }) },
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toContain("location");
    expect(JSON.stringify(body)).not.toContain("Mueller");
    expect(await store.listMessages(started.contextId)).toHaveLength(0);
  });
});

describe("a model outage does not drop a follow-up", () => {
  beforeEach(() => {
    process.env.MODEL_RETRY_SCALE = "0";
  });
  afterEach(() => {
    delete process.env.MODEL_RETRY_SCALE;
  });

  it("opens the coffee in code from the person's own daytime windows, with no place and no model proof", async () => {
    installFakeModel(Array.from({ length: 30 }, () => ({ error: 404, code: "model_not_found" })));
    const started = await startFollowUp(store, { target: "jules" });
    if (!started.ok || !started.started) throw new Error("expected a start");
    const result = await runFollowUpTurn({ store, agent: "aaron", contact: jules, contextId: started.contextId, deliver: localDeliver(store, "aaron") });
    expect(result).toMatchObject({ status: "completed", fallback: true });

    const [record] = await store.listMessages(started.contextId);
    expect(record.message).toMatchObject({ from: "aaron", to: "lisa", type: "intent", activity: { kind: "events", title: "Coffee" } });
    expect(record.message.activity?.place).toBeUndefined();
    expect(record.proof).toBeUndefined();
    for (const window of record.message.windows ?? []) {
      expect(Date.parse(window.end) - Date.parse(window.start)).toBeLessThanOrEqual(2 * 3_600_000);
      const hour = Number(window.start.slice(11, 13));
      expect(hour).toBeGreaterThanOrEqual(10);
      expect(hour).toBeLessThan(19);
    }
    expect(JSON.stringify(record.message)).not.toMatch(/location/);
    expect((await store.getPlanByContext(started.contextId))?.state).toBe("negotiating");
    expect((await store.listEvents()).some((event) => event.text.startsWith("Fallback") && event.text.includes("Jules"))).toBe(true);
  });
});
