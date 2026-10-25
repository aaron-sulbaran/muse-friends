import { afterEach, describe, expect, it, vi } from "vitest";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { postPaymentsScope, postSettle } from "@/lib/ui/actions";
import { viewForRole, type ChatItem } from "@/lib/ui/chat";
import { formatDollars, paymentsForPlan, settleOffer, sideOfPayment, walletChipFor } from "@/lib/ui/payments";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import type { PlanState, UiPayment, UiSnapshot } from "@/lib/ui/types";

const live = { mode: "live" } as const;

const wallet = (balance: number, accountId: string) => ({ balance, nickname: "Checking", source: "nessie" as const, accountId });
const off = { enabled: false, cap: 20 };
const on = { enabled: true, cap: 30 };

function payment(over: Partial<UiPayment> = {}): UiPayment {
  return {
    id: "pay_1",
    planId: "plan_shawarma_001",
    from: "aaron",
    to: "lisa",
    amount: 15,
    reason: "Covering the shawarma plate",
    status: "sent",
    source: "nessie",
    withdrawalId: "wd_1",
    at: "2026-10-27T20:00:00-05:00",
    ...over,
  };
}

function at(state: PlanState, over: Partial<UiSnapshot> = {}): UiSnapshot {
  const base = toUiSnapshot(snapshotAtPlanState(state), live);
  return {
    ...base,
    wallets: { aaron: wallet(105, "acct_a"), lisa: wallet(95, "acct_b") },
    payments: [],
    paymentsScope: { aaron: on, lisa: off },
    sandbox: { enabled: true, connected: true, text: "Capital One Nessie sandbox" },
    ...over,
  };
}

const kinds = (items: ChatItem[]) => items.map((item) => item.kind);

describe("the wallet chip", () => {
  it("shows the balance in whole paper dollars with the sandbox named", () => {
    expect(walletChipFor(at("scheduled"), "aaron")).toEqual({ balance: "$105", label: "Capital One sandbox" });
    expect(walletChipFor(at("scheduled"), "lisa")).toEqual({ balance: "$95", label: "Capital One sandbox" });
  });

  it("is hidden over the local ledger, with payments off, and before a wallet exists", () => {
    const local = { enabled: true, connected: false, text: "Sandbox not connected, using a local ledger" };
    expect(walletChipFor(at("scheduled", { sandbox: local }), "aaron")).toBeNull();
    expect(walletChipFor(at("scheduled", { sandbox: { ...local, enabled: false } }), "aaron")).toBeNull();
    expect(walletChipFor(at("scheduled", { wallets: { aaron: null, lisa: null } }), "aaron")).toBeNull();
  });

  it("rounds nothing it was not given: dollars only", () => {
    expect(formatDollars(1200)).toBe("$1,200");
    expect(formatDollars(15)).toBe("$15");
  });
});

describe("whether a phone offers Settle up", () => {
  it("waits for a confirmed plan", () => {
    for (const state of ["detected", "negotiating", "awaiting_humans", "dropped"] as const) {
      expect(settleOffer(at(state), snapshotPlan(state), "aaron")).toEqual({ kind: "hidden" });
    }
    for (const state of ["confirmed", "scheduled", "reminded", "happened", "followed_up"] as const) {
      expect(settleOffer(at(state), snapshotPlan(state), "aaron")).toMatchObject({ kind: "ready", cap: 30 });
    }
  });

  it("offers to turn payments on when this seat has not, and says nothing when the room has payments off", () => {
    expect(settleOffer(at("scheduled"), snapshotPlan("scheduled"), "lisa")).toMatchObject({ kind: "turn_on" });
    expect(settleOffer(at("scheduled", { sandbox: { enabled: false, connected: false, text: "Payments are switched off" } }), snapshotPlan("scheduled"), "aaron")).toEqual({ kind: "hidden" });
  });

  it("treats a cap of 0 as off, as the server does", () => {
    expect(settleOffer(at("scheduled", { paymentsScope: { aaron: { enabled: true, cap: 0 }, lisa: off } }), snapshotPlan("scheduled"), "aaron")).toMatchObject({ kind: "turn_on" });
  });

  it("holds a second ask while one payment is still waiting, calls the plan settled once the friend kept it, and offers again if it came back", () => {
    expect(settleOffer(at("scheduled", { payments: [payment({ status: "sent" })] }), snapshotPlan("scheduled"), "aaron")).toEqual({ kind: "waiting" });
    expect(settleOffer(at("scheduled", { payments: [payment({ status: "received" })] }), snapshotPlan("scheduled"), "aaron")).toEqual({ kind: "settled", amount: 15 });
    expect(settleOffer(at("scheduled", { payments: [payment({ status: "refunded" })] }), snapshotPlan("scheduled"), "aaron")).toMatchObject({ kind: "ready", cap: 30 });
  });
});

function snapshotPlan(state: PlanState) {
  const plan = at(state).plan;
  if (!plan) throw new Error("fixture has no plan");
  return plan;
}

describe("money in the chat", () => {
  it("puts one card per payment on both phones, from each person's side", () => {
    const snapshot = at("scheduled", { payments: [payment({ status: "received", balanceBefore: 80, balanceAfter: 95 })] });
    const a = viewForRole(snapshot, "a").items.find((item) => item.kind === "payment-card");
    const b = viewForRole(snapshot, "b").items.find((item) => item.kind === "payment-card");
    expect(a).toMatchObject({ side: "payer", friendName: "your friend" });
    expect(b).toMatchObject({ side: "payee", friendName: "your friend" });
    expect(paymentsForPlan(snapshot, snapshotPlan("scheduled"))).toHaveLength(1);
    expect(sideOfPayment(payment(), "aaron")).toBe("payer");
    expect(sideOfPayment(payment(), "lisa")).toBe("payee");
  });

  it("offers Settle up after a confirmed plan, and not while a payment waits", () => {
    expect(kinds(viewForRole(at("scheduled"), "a").items)).toContain("settle-card");
    expect(kinds(viewForRole(at("scheduled"), "b").items)).toContain("settle-card");
    expect(kinds(viewForRole(at("scheduled", { payments: [payment()] }), "a").items)).not.toContain("settle-card");
    expect(kinds(viewForRole(at("awaiting_humans"), "a").items)).not.toContain("settle-card");
  });

  it("leaves the chat exactly as it was when payments are off for the room", () => {
    const snapshot = at("scheduled", { sandbox: { enabled: false, connected: false, text: "Payments are switched off" } });
    for (const role of ["a", "b"] as const) {
      expect(kinds(viewForRole(snapshot, role).items)).not.toContain("settle-card");
      expect(kinds(viewForRole(snapshot, role).items)).not.toContain("payment-card");
    }
  });
});

describe("the calls the phone makes", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(status = 200, body: unknown = { data: {}, error: null }) {
    const mock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", mock);
    return mock;
  }
  const sent = (mock: ReturnType<typeof stubFetch>) => {
    const [url, init] = mock.mock.calls[0] as unknown as [string, { body: string }];
    return { url, body: JSON.parse(init.body) };
  };

  it("asks for a settle with the role and, when there is one, the note", async () => {
    const mock = stubFetch(202);
    expect(await postSettle("plan_1", "a", "I will cover the plate")).toEqual({ ok: true });
    expect(sent(mock)).toEqual({ url: "/api/plans/plan_1/settle", body: { role: "a", note: "I will cover the plate" } });
    const plain = stubFetch(202);
    await postSettle("plan_1", "b");
    expect(sent(plain).body).toEqual({ role: "b" });
  });

  it("reads a paused settle as the caps fallback and a refusal as its own words", async () => {
    stubFetch(429, { paused: true, text: "Live runs paused, playing a recording" });
    expect(await postSettle("plan_1", "a")).toMatchObject({ ok: false, paused: true });
    stubFetch(409, { error: { message: "Payments are off for Sprout's Muse" } });
    expect(await postSettle("plan_1", "a")).toEqual({ ok: false, message: "Payments are off for Sprout's Muse" });
  });

  it("sets a seat's payments on or off, and the cap only when one is given", async () => {
    const mock = stubFetch();
    await postPaymentsScope("b", true);
    expect(sent(mock)).toEqual({ url: "/api/controls", body: { type: "payments", side: "b", enabled: true } });
    const capped = stubFetch();
    await postPaymentsScope("a", true, 30);
    expect(sent(capped).body).toEqual({ type: "payments", side: "a", enabled: true, cap: 30 });
  });
});
