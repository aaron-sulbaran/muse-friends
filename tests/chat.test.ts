import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRunBudget, chatBudget } from "@/lib/agent/caps";
import { buildChatTools, CHAT_TOOL_NAMES, WHERE_TO_DO } from "@/lib/agent/chat-tools";
import { runChatTurn } from "@/lib/agent/chat";
import { resetDemo } from "@/lib/agent/controls";
import { injectSignal } from "@/lib/agent/runtime";
import { putProposal } from "@/lib/agent/proposal-store";
import { ensureWallets, walletOf } from "@/lib/agent/wallets";
import type { PaymentProposal, Plan, SharePolicy } from "@/lib/protocol";
import { rawShawarmaSignal } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";

// The chat with a person's own Muse (D31): a model turn over read-only tools, answers from the same data the cards
// show, a "You asked" row with the tools used, and no way to move money or message the friend from here.

let store: JsonStore;
let plan: Plan;
let clock: number;
const wallNow = () => (clock += 1000);

const policy = (owner: "aaron" | "lisa", cap: number, enabled = true): SharePolicy => ({
  owner,
  friend: owner === "aaron" ? "lisa" : "aaron",
  tier: "close",
  categories: {},
  payments: { enabled, capPerPlan: cap },
});

const proposal = (patch: Partial<PaymentProposal> = {}): PaymentProposal => ({
  paymentId: "pay_chat1",
  planId: plan.id,
  payer: "aaron",
  payee: "lisa",
  amount: 16,
  reason: "Your half of the shawarma dinner",
  breakdown: [
    { label: "Chicken shawarma plate", amount: 13, source: "call_read" },
    { label: "Half of tax", amount: 1, source: "call_read" },
    { label: "My rounding", amount: 2, source: "estimate" },
  ],
  calls: [{ callId: "call_read", name: "read_receipt" }],
  receipt: { id: "rcpt_shawarma_seeded", place: "Shawarma Point", seeded: true, total: 30 },
  source: "local",
  status: "proposed",
  proposedAt: "2026-10-25T20:00:00-05:00",
  ...patch,
});

// The function_call_output items the fake model was handed, parsed, in order.
function toolOutputs(calls: Array<{ input: unknown }>): Array<Record<string, unknown>> {
  const last = calls.at(-1)?.input;
  return (Array.isArray(last) ? last : [])
    .filter((item) => (item as { type?: string }).type === "function_call_output")
    .map((item) => JSON.parse((item as { output: string }).output) as Record<string, unknown>);
}

beforeEach(async () => {
  clock = Date.parse("2026-10-25T20:00:00-05:00");
  store = new JsonStore(null);
  delete process.env.NESSIE_KEY;
  delete process.env.PAYMENTS;
  process.env.MODEL_RETRY_SCALE = "0";
  resetRunBudget();
  await ensureWallets(store, wallNow);
  const { planId } = await injectSignal(store, { ...rawShawarmaSignal(), id: "sig_chat" }, wallNow);
  plan = {
    ...(await store.getPlan(planId))!,
    state: "confirmed",
    activity: { kind: "food", title: "Shawarma Point", place: "E 6th St" },
    window: { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" },
  };
  await store.putPlan(plan);
  await store.putPolicy(policy("aaron", 20));
  await store.putPolicy(policy("lisa", 0, false));
});
afterEach(() => {
  removeFakeModel();
  delete process.env.MODEL_RETRY_SCALE;
  delete process.env.MAX_CHAT_TURNS_PER_ROOM_PER_HOUR;
  delete process.env.PAYMENTS;
});

describe("a question about the plan", () => {
  it("calls get_plan, answers from it, and leaves the exchange, the proof and a 'You asked' row", async () => {
    const fake = installFakeModel([{ calls: [{ name: "get_plan", args: {} }] }, { text: "We're set for Shawarma Point on Tuesday, 6 to 8 PM." }]);
    const outcome = await runChatTurn({ store, text: "Where are we eating?", wallNow });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // The model was handed the real plan, not a guess.
    expect(toolOutputs(fake.calls)[0]).toMatchObject({ state: "confirmed", what: "Shawarma Point", place: "E 6th St", with: "Mochi", decisions: { you: "pending" } });
    expect(outcome.answer).toMatchObject({ from: "muse", text: "We're set for Shawarma Point on Tuesday, 6 to 8 PM.", replyTo: outcome.question.id });
    expect(outcome.answer.proof).toMatchObject({ model: "muse-spark-1.3", toolCalls: [{ name: "get_plan", args: "", result: "plan confirmed" }] });

    const room = await store.getRoom();
    expect(room.chat?.map((entry) => [entry.from, entry.text])).toEqual([
      ["user", "Where are we eating?"],
      ["muse", "We're set for Shawarma Point on Tuesday, 6 to 8 PM."],
    ]);
    const rows = (await store.listEvents()).filter((event) => event.kind === "chat_asked");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: "human", agent: "aaron", planId: plan.id, messageId: outcome.answer.id, text: "You asked: Where are we eating?" });

    // What a screen reads: the chat in order, and the row paired with the answer and its tools.
    const ui = toUiSnapshot(await store.snapshot(), { mode: "live" });
    expect(ui.chat.map((line) => line.from)).toEqual(["user", "muse"]);
    expect(ui.chat[1]).toMatchObject({ replyTo: ui.chat[0].id, proof: { toolCalls: [{ name: "get_plan" }] } });
    expect(ui.notes.find((note) => note.kind === "chat_asked")).toMatchObject({ text: "You asked: Where are we eating?", answerId: outcome.answer.id, toolCalls: [{ name: "get_plan", result: "plan confirmed" }] });
  });

  it("carries the earlier lines into the next question so a follow-up has something to follow", async () => {
    const first = installFakeModel([{ text: "Dinner at Shawarma Point." }]);
    await runChatTurn({ store, text: "What is the plan?", wallNow });
    expect(first.calls).toHaveLength(1);
    removeFakeModel();
    const second = installFakeModel([{ text: "Tuesday at 6." }]);
    await runChatTurn({ store, text: "And when?", wallNow });
    const input = JSON.stringify(second.calls[0].input);
    expect(input).toContain("Earlier in this chat");
    expect(input).toContain("What is the plan?");
    expect(input).toContain("Dinner at Shawarma Point.");
  });
});

describe("'why $16?'", () => {
  it("answers from the same lines the payment card shows, with where each came from", async () => {
    await putProposal(store, proposal());
    const fake = installFakeModel([
      { calls: [{ name: "get_wallet_and_history", args: {} }] },
      { calls: [{ name: "explain_payment", args: { paymentId: "pay_chat1" } }] },
      { text: "Your plate was $13, half the tax was $1, and I rounded up $2 myself, so $16." },
    ]);
    const outcome = await runChatTurn({ store, text: "why 16?", wallNow });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    const [history, explained] = toolOutputs(fake.calls);
    expect(history).toMatchObject({ wallet: { balance: 120 }, allowance: { perPlan: 20 }, payments: [{ paymentId: "pay_chat1", direction: "you paid", with: "Mochi", amount: 16, status: expect.stringContaining("waiting for you to confirm"), date: "2026-10-25" }] });
    expect(explained).toMatchObject({
      total: 16,
      receipt: { place: "Shawarma Point", total: 30, sample: true },
      lines: [
        { label: "Chicken shawarma plate", amount: 13, cameFrom: "the receipt from Shawarma Point (a sample receipt, not a real one)" },
        { label: "Half of tax", amount: 1, cameFrom: "the receipt from Shawarma Point (a sample receipt, not a real one)" },
        { label: "My rounding", amount: 2, cameFrom: "my own estimate" },
      ],
    });
    expect(outcome.answer.proof?.toolCalls).toMatchObject([
      { name: "get_wallet_and_history", args: "", result: "wallet read, 1 payment" },
      { name: "explain_payment", args: "pay_chat1", result: "3 lines explained" },
    ]);
  });

  it("says so when a payment has no recorded breakdown, and refuses an id that is not this person's", async () => {
    const tools = buildChatTools({ store, agent: "aaron", wallNow });
    expect(await tools.handlers.explain_payment({ paymentId: "pay_nope" })).toMatchObject({ error: expect.stringContaining("No payment with that id") });
    expect(await tools.handlers.explain_payment({ paymentId: "" })).toMatchObject({ error: expect.stringContaining("Invalid arguments") });
  });
});

describe("a request to act", () => {
  it("is pointed at the settle card, and nothing moves, sends or gets prepared", async () => {
    const fake = installFakeModel([{ calls: [{ name: "where_to_do_that", args: { action: "pay" } }] }, { text: WHERE_TO_DO.pay }]);
    const before = await walletOf(store, "aaron");
    const outcome = await runChatTurn({ store, text: "pay Mochi $15 for dinner", wallNow });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(toolOutputs(fake.calls)[0]).toEqual({ done: false, say: WHERE_TO_DO.pay });
    expect(WHERE_TO_DO.pay).toContain("Settle up");
    expect(outcome.answer.text).toBe(WHERE_TO_DO.pay);
    expect(outcome.answer.proof?.toolCalls).toMatchObject([{ name: "where_to_do_that", args: "pay", result: "pointed to the card" }]);
    expect(await walletOf(store, "aaron")).toEqual(before);
    expect((await store.getRoom()).proposals).toBeUndefined();
    expect((await store.listMessages()).filter((record) => record.message.type === "payment")).toEqual([]);
  });

  it("has no tool that sends, pays, decides or changes anything, so a model that asks for one gets an error", async () => {
    const fake = installFakeModel([{ calls: [{ name: "send_money", args: { to: "lisa", amount: 15, reason: "dinner", breakdown: [{ label: "x", amount: 15, source: "estimate" }] } }] }, { text: "I can't do that from here." }]);
    const messagesBefore = (await store.listMessages()).length;
    const outcome = await runChatTurn({ store, text: "send Mochi fifteen dollars", wallNow });
    expect(outcome.ok).toBe(true);

    // The function tools are the read tools; the one other tool is the API's own hosted web search (no handler here, it only reads the web).
    const offered = (fake.calls[0].tools as Array<{ name?: string; type: string }>).map((tool) => tool.name ?? tool.type).sort();
    expect(offered).toEqual([...CHAT_TOOL_NAMES, "web_search"].sort());
    for (const forbidden of ["send_money", "send_to_friend_agent", "accept_payment", "decline_payment", "record_reel_details", "read_receipt"]) expect(offered).not.toContain(forbidden);
    expect(toolOutputs(fake.calls)[0]).toMatchObject({ error: expect.any(String) });
    expect(await walletOf(store, "aaron")).toMatchObject({ balance: 120 });
    expect((await store.getRoom()).proposals).toBeUndefined();
    expect((await store.listMessages()).length).toBe(messagesBefore);
  });
});

describe("when the model is down", () => {
  it("stores nothing, says why, and leaves a turn_failed row", async () => {
    installFakeModel([{ error: 500 }]);
    const outcome = await runChatTurn({ store, text: "Where are we eating?", wallNow });
    expect(outcome).toEqual({ ok: false, status: 503, error: "Sprout's Muse could not answer just now: the model is not responding. Your question was not sent; try again in a moment." });
    expect((await store.getRoom()).chat).toBeUndefined();
    const events = await store.listEvents();
    expect(events.some((event) => event.kind === "chat_asked")).toBe(false);
    expect(events.filter((event) => event.kind === "turn_failed").at(-1)).toMatchObject({ agent: "aaron", text: expect.stringContaining("could not answer a chat question") });
  });

  it("an empty answer is a failure too, not a blank bubble", async () => {
    installFakeModel([{ text: "   " }]);
    expect(await runChatTurn({ store, text: "hello?", wallNow })).toMatchObject({ ok: false, status: 503 });
    expect((await store.getRoom()).chat).toBeUndefined();
  });
});

describe("what the tools read", () => {
  it("reads the reel, the sharing settings and the plan for side a only", async () => {
    const tools = buildChatTools({ store, agent: "aaron", wallNow });
    expect(await tools.handlers.get_reel({})).toMatchObject({ from: "Mochi", provenance: "a seeded, fictional reel", caption: expect.any(String) });
    expect(await tools.handlers.get_plan({})).toMatchObject({ planId: plan.id, with: "Mochi", when: expect.stringContaining("Tue") });
    expect(await tools.handlers.get_sharing({})).toMatchObject({
      friend: "Mochi",
      youShare: { level: "close", categories: { food: true, location: true }, payments: { allowed: true, perPlan: 20 } },
      theyShare: { payments: { allowed: false } },
      heldBack: [],
    });
  });

  it("says plainly when there is nothing yet", async () => {
    const empty = new JsonStore(null);
    const tools = buildChatTools({ store: empty, agent: "aaron", wallNow });
    expect(await tools.handlers.get_plan({})).toMatchObject({ none: true });
    expect(await tools.handlers.get_reel({})).toMatchObject({ none: true });
  });

  it("never hands the model the title of a private event, since the answer is kept on the room", async () => {
    await store.addBusy({ agent: "aaron", event: { id: "busy_private", title: "Therapy with Dr. Sol", start: "2026-10-27T09:00:00-05:00", end: "2026-10-27T10:00:00-05:00", private: true } });
    const tools = buildChatTools({ store, agent: "aaron", wallNow });
    const calendar = await tools.handlers.get_my_calendar({ start: "2026-10-27T00:00:00-05:00", end: "2026-10-28T00:00:00-05:00" });
    expect(JSON.stringify(calendar)).not.toContain("Therapy");
    expect(JSON.stringify(calendar)).toContain("a private event");
  });
});

describe("the room", () => {
  it("Reset clears the chat, and the snapshot never has a line for side b", async () => {
    installFakeModel([{ text: "Dinner at Shawarma Point." }]);
    await runChatTurn({ store, text: "What is the plan?", wallNow });
    expect(toUiSnapshot(await store.snapshot(), { mode: "live" }).chat).toHaveLength(2);
    await resetDemo(store, {}, { wallNow });
    expect((await store.getRoom()).chat).toBeUndefined();
    expect(toUiSnapshot(await store.snapshot(), { mode: "live" }).chat).toEqual([]);
  });

  it("says Michelle in the chat when the simulated friend plays side b, like the rest of the screen", async () => {
    await store.putRoom({ ...(await store.getRoom()), simulatedFriend: true });
    installFakeModel([{ text: "Mochi's Muse agreed to Tuesday." }]);
    await runChatTurn({ store, text: "Did they agree?", wallNow });
    expect(toUiSnapshot(await store.snapshot(), { mode: "live" }).chat[1].text).toBe("Michelle's Muse agreed to Tuesday.");
  });

  it("keeps the last forty lines", async () => {
    for (let turn = 0; turn < 22; turn += 1) {
      installFakeModel([{ text: `Answer ${turn}.` }]);
      await runChatTurn({ store, text: `Question ${turn}?`, wallNow });
    }
    const chat = (await store.getRoom()).chat!;
    expect(chat).toHaveLength(40);
    expect(chat.at(-1)!.text).toBe("Answer 21.");
    expect(chat[0].text).toBe("Question 2?");
  });

  it("refuses an empty or over-long question before any model call", async () => {
    const fake = installFakeModel([]);
    expect(await runChatTurn({ store, text: "   ", wallNow })).toMatchObject({ ok: false, status: 400 });
    expect(await runChatTurn({ store, text: "x".repeat(501), wallNow })).toMatchObject({ ok: false, status: 400 });
    expect(fake.calls).toHaveLength(0);
  });
});

describe("the chat route", () => {
  const postChat = async (body: unknown) => {
    (globalThis as { __museStore?: unknown }).__museStore = Promise.resolve(store);
    const { POST } = await import("@/app/api/chat/route");
    return POST(new Request("http://localhost:3001/api/chat", { method: "POST", body: JSON.stringify(body) }));
  };
  afterEach(() => {
    (globalThis as { __museStore?: unknown }).__museStore = undefined;
  });
  it("answers 200 with the question and the answer", async () => {
    installFakeModel([{ text: "Dinner at Shawarma Point." }]);
    const response = await postChat({ text: "What is the plan?" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({ question: { from: "user", text: "What is the plan?" }, answer: { from: "muse", text: "Dinner at Shawarma Point." }, budget: { used: 1, limit: 20 } });
  });

  it("answers 400 for a bad body, 403 for side b (no chat there), and 503 with the reason when the model is down, giving the slot back", async () => {
    expect((await postChat({ text: "" })).status).toBe(400);
    expect((await postChat({ text: "x".repeat(501) })).status).toBe(400);
    expect((await postChat({ role: "c", text: "hi" })).status).toBe(400);
    const sideB = await postChat({ role: "b", text: "hi" });
    expect(sideB.status).toBe(403);
    expect((await sideB.json()).error.message).toContain("friend's side has no chat");
    expect(chatBudget().used).toBe(0);

    installFakeModel([{ error: 500 }]);
    const down = await postChat({ text: "Where are we eating?" });
    expect(down.status).toBe(503);
    expect((await down.json()).error.message).toContain("the model is not responding");
    expect(chatBudget().used).toBe(0);
  });

  it("answers 429 past the hourly cap of chat turns, 20 by default", async () => {
    process.env.MAX_CHAT_TURNS_PER_ROOM_PER_HOUR = "2";
    installFakeModel([{ text: "One." }, { text: "Two." }]);
    expect((await postChat({ text: "first?" })).status).toBe(200);
    expect((await postChat({ text: "second?" })).status).toBe(200);
    const paused = await postChat({ text: "third?" });
    expect(paused.status).toBe(429);
    expect(await paused.json()).toMatchObject({ paused: true, reason: "room", budget: { used: 2, limit: 2, remaining: 0 } });
    expect(paused.headers.get("Retry-After")).toBeTruthy();
    delete process.env.MAX_CHAT_TURNS_PER_ROOM_PER_HOUR;
    expect(chatBudget().limit).toBe(20);
  });
});
