import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAgentTurn, type ToolDefinition, type ToolMeta } from "@/lib/model";
import { injectSignal } from "@/lib/agent/runtime";
import { runSettleTurn } from "@/lib/agent/payment-runtime";
import { acceptPayment, sendMoney, type PaymentContext } from "@/lib/agent/payments";
import { confirmProposal } from "@/lib/agent/proposals";
import { PAYING_TTL_MS } from "@/lib/agent/paying";
import { ensureWallets } from "@/lib/agent/wallets";
import { localDeliver } from "@/lib/agent/wire";
import type { AgentId, Plan, SharePolicy } from "@/lib/protocol";
import { rawShawarmaSignal, seedSnapshot } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import { toolCallsOf } from "@/lib/ui/tools";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";

// The timers behind the Activity timeline: how long each tool took, since when each Muse has been working, and the
// sandbox call that moves the money shown as a tool call of its own.

vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: () => undefined }));

const tool = (name: string): ToolDefinition => ({ name, description: name, parameters: { type: "object", properties: {} } });

let store: JsonStore;
let plan: Plan;
let clock: number;
const wallNow = () => (clock += 1000);
const policy = (owner: AgentId, cap: number): SharePolicy => ({ owner, friend: owner === "aaron" ? "lisa" : "aaron", tier: "close", categories: {}, payments: { enabled: cap > 0, capPerPlan: cap } });
const deliverAs = (agent: AgentId) => localDeliver(store, agent);
const ctx = (agent: AgentId = "aaron"): PaymentContext => ({ store, agent, planId: plan.id, wallNow, deliver: deliverAs(agent) });
const meta = (toolCalls: ToolMeta["toolCalls"] = []): ToolMeta => ({
  responseId: "resp_x",
  model: "muse-spark-1.3",
  call: { responseId: "resp_x", model: "muse-spark-1.3", ms: 800, chained: false, chainRetries: 0, toolNames: [], inputTokens: 10, outputTokens: 5, reasoningTokens: 2, cachedTokens: 0 },
  toolCalls,
  callId: "call_send",
  finishedCalls: [],
});
const live = (nowMs?: number) => ({ mode: "live" as const, ...(nowMs !== undefined ? { nowMs } : {}) });

beforeEach(async () => {
  clock = Date.parse("2026-10-25T20:00:00-05:00");
  store = new JsonStore(null);
  delete process.env.NESSIE_KEY;
  delete process.env.PAYMENTS;
  await ensureWallets(store, wallNow);
  const { planId } = await injectSignal(store, { ...rawShawarmaSignal(), id: "sig_timers" }, wallNow);
  plan = { ...(await store.getPlan(planId))!, state: "confirmed", activity: { kind: "food", title: "Shawarma Point", place: "E 6th St" }, window: { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" } };
  await store.putPlan(plan);
  await store.putPolicy(policy("aaron", 20));
  await store.putPolicy(policy("lisa", 0));
});
afterEach(() => {
  removeFakeModel();
  delete process.env.PAYMENTS;
});

describe("how long a tool took", () => {
  it("is measured around each handler, on the trace and on the summaries the next tool is told about", async () => {
    installFakeModel([{ calls: [{ name: "slow", args: {} }] }, { calls: [{ name: "quick", args: {} }] }, { text: "done" }]);
    const told: ToolMeta["toolCalls"][] = [];
    const result = await runAgentTurn({
      instructions: "x",
      input: "go",
      tools: [tool("slow"), tool("quick")],
      handlers: {
        slow: async () => (await new Promise((resolve) => setTimeout(resolve, 40)), {}),
        quick: async (_args, toolMeta) => (told.push(toolMeta?.toolCalls ?? []), {}),
      },
    });
    expect(result.toolCalls[0].ms).toBeGreaterThanOrEqual(35);
    expect(result.toolCalls[1].ms).toBeLessThan(35);
    expect(told[0][0]).toMatchObject({ name: "slow", ms: expect.any(Number) });
    expect(told[0][0].ms).toBeGreaterThanOrEqual(35);
  });

  it("reaches the screen as ms on each tool call, only when it is a real number", () => {
    expect(toolCallsOf({ toolCalls: [{ name: "get_my_calendar", args: "", result: "", ms: 412.4 }, { name: "x", args: "", result: "", ms: -3 }, { name: "y", args: "", result: "", ms: "fast" }, { name: "z", args: "", result: "" }] })).toEqual([
      { name: "get_my_calendar", args: "", result: "", ms: 412 },
      { name: "x", args: "", result: "" },
      { name: "y", args: "", result: "" },
      { name: "z", args: "", result: "" },
    ]);
  });
});

describe("the ledger call on a payment", () => {
  async function paid() {
    const prepared = await sendMoney(ctx(), { to: "lisa", amount: 16, reason: "dinner", breakdown: [{ label: "My estimate", amount: 16, source: "estimate" }] }, meta([{ name: "get_wallet", args: "", result: "balance read", ms: 120 }]));
    const paymentId = (prepared as { paymentId: string }).paymentId;
    expect((await confirmProposal({ store, wallNow, deliver: deliverAs("aaron") }, paymentId, "aaron")).ok).toBe(true);
    const contextId = (await store.listMessages())[0].message.contextId;
    await acceptPayment({ store, agent: "lisa", contextId, wallNow, deliver: deliverAs("lisa") }, { paymentId }, meta([{ name: "get_wallet", args: "", result: "balance read", ms: 90 }]));
    return paymentId;
  }

  it("is recorded after the model's own calls, on the payer's message and on the payee's", async () => {
    await paid();
    const [sent, received] = await store.listMessages();
    expect(sent.proof?.toolCalls).toMatchObject([
      { name: "get_wallet", ms: 120 },
      { name: "send_money", args: "$16 to lisa, 1 line", ms: expect.any(Number) },
      { name: "ledger_transfer", args: "$16 from the local ledger", result: expect.stringMatching(/^withdrawal wd_local_\w+ recorded$/), ms: expect.any(Number) },
    ]);
    expect(received.proof?.toolCalls).toMatchObject([{ name: "get_wallet", ms: 90 }, { name: "accept_payment" }, { name: "ledger_deposit", args: "$16 to the local ledger", result: expect.stringMatching(/^deposit \w+ recorded$/), ms: expect.any(Number) }]);
  });

  it("names the Nessie sandbox and its account when the wallet is on it", async () => {
    const { sandboxCall } = await import("@/lib/agent/payments");
    expect(sandboxCall("transfer", { source: "nessie", accountId: "5f0a1c2d3e4b5a6978879605" }, 16, "wd_9", 640)).toEqual({ name: "nessie_transfer", args: "$16 from 5f0a1c2d3e4b5a6978879605", result: "withdrawal wd_9 recorded", ms: 640 });
    expect(sandboxCall("deposit", { source: "nessie", accountId: "5f0a1c2d3e4b5a6978879605" }, 16, "dp_2", 510)).toEqual({ name: "nessie_deposit", args: "$16 to 5f0a1c2d3e4b5a6978879605", result: "deposit dp_2 recorded", ms: 510 });
  });

  it("puts tool lines under the prepared row, the sent row (the ledger call only) and the received row", async () => {
    const id = await paid();
    const notes = toUiSnapshot(await store.snapshot(), live()).notes;
    const byKind = (kind: string) => notes.find((note) => note.kind === kind);
    expect(byKind("payment_proposed")?.toolCalls?.map((call) => call.name)).toEqual(["get_wallet", "send_money"]);
    expect(byKind("payment_proposed")?.toolCalls?.[0].ms).toBe(120);
    expect(byKind("payment_sent")?.toolCalls?.map((call) => call.name)).toEqual(["ledger_transfer"]);
    expect(byKind("payment_sent")?.toolCalls?.[0]).toMatchObject({ args: "$16 from the local ledger", ms: expect.any(Number) });
    expect(byKind("payment_received")?.toolCalls?.map((call) => call.name)).toEqual(["get_wallet", "accept_payment", "ledger_deposit"]);
    expect((await store.listEvents()).find((event) => event.kind === "payment_proposed")?.contextId).toBe(`pay_${id}`);
    const payment = toUiSnapshot(await store.snapshot(), live()).payments[0];
    expect(payment.toolCalls?.map((call) => call.name)).toEqual(["get_wallet", "send_money", "ledger_transfer", "get_wallet", "accept_payment", "ledger_deposit"]);
  });

  it("shows no tool lines on a row that has none to show", async () => {
    await paid();
    const notes = toUiSnapshot(await store.snapshot(), live()).notes;
    for (const note of notes.filter((entry) => !entry.kind.startsWith("payment_") && entry.kind !== "chat_asked")) expect(note.toolCalls, note.kind).toBeUndefined();
  });
});

describe("who is working, and since when", () => {
  it("gives the time the turn was handed over, for the agent that has it", async () => {
    const state = seedSnapshot();
    const stored = new JsonStore(null);
    await stored.replaceAll(state);
    const { planId, contextId } = await injectSignal(stored, { ...rawShawarmaSignal(), id: "sig_since" }, () => Date.parse("2026-10-25T20:00:00-05:00"));
    const snapshot = toUiSnapshot(await stored.snapshot(), live());
    expect(snapshot.inFlight).toMatchObject({ agent: "aaron", agents: ["aaron"], since: { aaron: (await stored.getPlan(planId))!.createdAt } });
    expect(snapshot.inFlight?.payment).toBeUndefined();
    expect(contextId).toBeTruthy();
  });
});

describe("the payer's Muse settling up", () => {
  it("is on for the whole confirm, and off again afterwards", async () => {
    const prepared = await sendMoney(ctx(), { to: "lisa", amount: 16, reason: "dinner", breakdown: [{ label: "My estimate", amount: 16, source: "estimate" }] }, meta());
    const paymentId = (prepared as { paymentId: string }).paymentId;
    const seen: unknown[] = [];
    const inner = deliverAs("aaron");
    // The friend's inbox is reached in the middle of the confirm: this is what a phone polling right then would read.
    const deliver: typeof inner = async (outgoing) => {
      seen.push(toUiSnapshot(await store.snapshot(), live(clock)).inFlight);
      return inner(outgoing);
    };
    const outcome = await confirmProposal({ store, wallNow, deliver }, paymentId, "aaron");
    expect(outcome.ok).toBe(true);
    expect(seen).toEqual([{ agent: "aaron", agents: ["aaron"], since: { aaron: expect.stringMatching(/^2026-10-25T/) }, payment: true }]);
    expect((await store.getRoom()).paying).toBeUndefined();
    expect(toUiSnapshot(await store.snapshot(), live(clock)).inFlight?.payment).toBeUndefined();
  });

  it("is cleared when the confirm fails too", async () => {
    const prepared = await sendMoney(ctx(), { to: "lisa", amount: 16, reason: "dinner", breakdown: [{ label: "My estimate", amount: 16, source: "estimate" }] }, meta());
    const paymentId = (prepared as { paymentId: string }).paymentId;
    const outcome = await confirmProposal({ store, wallNow, deliver: async () => ({ ok: false, status: 503, error: "inbox down" }) }, paymentId, "aaron");
    expect(outcome.ok).toBe(false);
    expect((await store.getRoom()).paying).toBeUndefined();
  });

  it("is not set by a confirm that is refused before any money could move", async () => {
    const prepared = await sendMoney(ctx(), { to: "lisa", amount: 16, reason: "dinner", breakdown: [{ label: "My estimate", amount: 16, source: "estimate" }] }, meta());
    const paymentId = (prepared as { paymentId: string }).paymentId;
    const rooms: unknown[] = [];
    const spy = new Proxy(store, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property === "putRoom") return async (room: { paying?: unknown }) => (rooms.push(room.paying), (value as (room: unknown) => Promise<void>).call(target, room));
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    expect((await confirmProposal({ store: spy, wallNow, deliver: deliverAs("lisa") }, paymentId, "lisa")).ok).toBe(false);
    expect(rooms).toEqual([]);
  });

  it("is on while the payer's Muse prepares the payment, and off when the turn is over", async () => {
    const rooms: Array<{ agent: string } | undefined> = [];
    const spy = new Proxy(store, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (property === "putRoom") return async (room: { paying?: { agent: string } }) => (rooms.push(room.paying), (value as (room: unknown) => Promise<void>).call(target, room));
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    installFakeModel([
      { calls: [{ name: "send_money", args: { to: "lisa", amount: 9, reason: "your half", breakdown: [{ label: "My estimate", amount: 9, source: "estimate" }] } }] },
      { text: "Prepared." },
    ]);
    const result = await runSettleTurn({ store: spy, agent: "aaron", planId: plan.id, wallNow });
    expect("refused" in result).toBe(false);
    // Other writes to the room while the model works (the proposal itself) carry the same marker along.
    const during = rooms.filter((paying) => paying !== undefined);
    expect(during.length).toBeGreaterThan(0);
    expect(new Set(during.map((paying) => JSON.stringify(paying))).size).toBe(1);
    expect(during[0]).toMatchObject({ agent: "aaron" });
    expect(rooms.at(-1)).toBeUndefined();
    expect((await store.getRoom()).paying).toBeUndefined();
  });

  it("is ignored once it is older than two minutes, so a crash cannot leave a phone saying it forever", async () => {
    const since = "2026-10-25T20:00:00-05:00";
    await store.putRoom({ ...(await store.getRoom()), paying: { agent: "aaron", since } });
    const at = Date.parse(since);
    expect(toUiSnapshot(await store.snapshot(), live(at + 1000)).inFlight).toMatchObject({ payment: true, agent: "aaron" });
    expect(toUiSnapshot(await store.snapshot(), live(at + PAYING_TTL_MS - 1)).inFlight?.payment).toBe(true);
    expect(toUiSnapshot(await store.snapshot(), live(at + PAYING_TTL_MS + 1)).inFlight?.payment).toBeUndefined();
  });

  it("is never kept in a recording that everyone can replay", async () => {
    const { recordCurrentRun } = await import("@/lib/agent/controls");
    await store.putRoom({ ...(await store.getRoom()), paying: { agent: "aaron", since: "2026-10-25T20:00:00-05:00" } });
    const run = await recordCurrentRun(store, { id: "run_paying", label: "while paying" });
    expect(run.snapshot.room.paying).toBeUndefined();
  });
});
