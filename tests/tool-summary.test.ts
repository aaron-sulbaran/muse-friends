import { describe, expect, it } from "vitest";
import { ModelProof } from "@/lib/protocol";
import { summarizeToolCall } from "@/lib/tool-summary";

const summarize = (name: string, args: unknown, output: unknown, ok = true) => summarizeToolCall({ name, args, output, ok });

describe("tool call summaries", () => {
  it("say what was asked and how much came back, never what the answer said", () => {
    expect(summarize("get_my_calendar", { start: "2026-10-26T00:00:00-05:00", end: "2026-11-01" }, { free: [{}, {}], busy: [{ title: "Family wedding", private: true }] })).toEqual({
      name: "get_my_calendar",
      args: "2026-10-26 to 2026-11-01",
      result: "2 free blocks, 1 busy",
    });
    expect(summarize("get_interests", {}, { food: ["shawarma"], events: ["live music", "hackathons"] })).toEqual({ name: "get_interests", args: "all", result: "3 interests" });
    expect(summarize("read_signal", {}, { from: "Mochi", message: "we should go!!", reel: { caption: "secret caption text" } })).toEqual({ name: "read_signal", args: "", result: "reel from Mochi" });
    expect(summarize("send_to_friend_agent", { type: "counter", windows: [{}, {}, {}], share: ["food", "interests"], note: "a private note" }, { ok: true, seq: 2, state: "working" })).toEqual({
      name: "send_to_friend_agent",
      args: "counter, 3 windows, share food+interests",
      result: "message #2 working",
    });
  });

  it("keeps balances, notes, captions, and private titles out of every summary", () => {
    const all = [
      summarize("get_my_calendar", { start: "2026-10-26", end: "2026-10-27" }, { free: [], busy: [{ title: "Interview, Northwind Labs" }] }),
      summarize("get_wallet", {}, { ok: true, balance: 120, capPerPlan: 20 }),
      summarize("send_money", { to: "lisa", amount: 12, reason: "covering Northwind Labs" }, { ok: true, amount: 12, balanceAfter: 108 }),
      summarize("accept_payment", { paymentId: "pay_1" }, { ok: true, amount: 12, balanceBefore: 80, balanceAfter: 92 }),
      summarize("record_reel_details", { place: "Shawarma Point", hours: "open until 9" }, { ok: true, saved: { hours: "open until 9" } }),
    ];
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/Northwind|120|108|92|open until/);
    expect(all.map((entry) => entry.result)).toEqual(["0 free blocks, 1 busy", "balance read", "withdrew $12, payment sent", "deposited $12", "saved"]);
  });

  it("reports an error in a line, and an unknown tool by name only", () => {
    expect(summarize("send_to_friend_agent", { type: "accept" }, { error: "You can only accept a window your friend offered.\nCounter instead." }, false)).toEqual({
      name: "send_to_friend_agent",
      args: "accept",
      result: "error: You can only accept a window your friend offered. Counter instead.",
    });
    expect(summarize("mystery_tool", { secret: "x" }, { leak: "y" })).toEqual({ name: "mystery_tool", args: "", result: "ok" });
  });

  it("stays one line and within the proof schema's limits whatever the model wrote", () => {
    const long = "x".repeat(500);
    const entry = summarize("get_interests", { category: `${long}\n${long}` }, { error: long }, false);
    expect(entry.args.length).toBeLessThanOrEqual(100);
    expect(entry.result.length).toBeLessThanOrEqual(100);
    expect(`${entry.args}${entry.result}`).not.toMatch(/\n/);
    expect(ModelProof.safeParse({ model: "m", responseId: "r", latencyMs: 1, inputTokens: 1, outputTokens: 1, reasoningTokens: 0, toolCalls: [entry] }).success).toBe(true);
  });

  it("is optional on the proof, so recordings made before it still parse", () => {
    expect(ModelProof.safeParse({ model: "m", responseId: "r", latencyMs: 1, inputTokens: 1, outputTokens: 1, reasoningTokens: 0 }).success).toBe(true);
  });
});
