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

const wentOutcome = { result: "went" as const, at: "2026-10-28T09:00:00-05:00", nextIdeaId: null, chosenBy: null };

/** The plan after the event, once the person has said they went: the only time the friend's Muse asks for her half. */
function afterWent(over: Partial<UiSnapshot> = {}): UiSnapshot {
  const base = at("followed_up", over);
  return { ...base, plan: { ...base.plan!, outcome: wentOutcome } };
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
  it("waits for the event: hidden until the plan is followed up and the person said they went", () => {
    for (const state of ["detected", "negotiating", "awaiting_humans", "dropped", "confirmed", "scheduled", "reminded", "happened"] as const) {
      expect(settleOffer(at(state), snapshotPlan(state), "aaron")).toEqual({ kind: "hidden" });
    }
    const followed = at("followed_up");
    expect(settleOffer(followed, { ...followed.plan!, outcome: null }, "aaron")).toEqual({ kind: "hidden" });
    expect(settleOffer(followed, { ...followed.plan!, outcome: { ...wentOutcome, result: "didnt" } }, "aaron")).toEqual({ kind: "hidden" });
    const went = afterWent();
    expect(settleOffer(went, went.plan, "aaron")).toMatchObject({ kind: "ready", cap: 30, place: went.plan!.activityTitle });
  });

  it("offers to turn payments on when this seat has not, and says nothing when the room has payments off", () => {
    const went = afterWent();
    expect(settleOffer(went, went.plan, "lisa")).toMatchObject({ kind: "turn_on" });
    const switchedOff = afterWent({ sandbox: { enabled: false, connected: false, text: "Payments are switched off" } });
    expect(settleOffer(switchedOff, switchedOff.plan, "aaron")).toEqual({ kind: "hidden" });
  });

  it("treats a cap of 0 as off, as the server does", () => {
    const zero = afterWent({ paymentsScope: { aaron: { enabled: true, cap: 0 }, lisa: off } });
    expect(settleOffer(zero, zero.plan, "aaron")).toMatchObject({ kind: "turn_on" });
  });

  it("holds a second ask while one payment is still waiting, calls the plan settled once the friend kept it, and offers again if it came back", () => {
    const sentOne = afterWent({ payments: [payment({ status: "sent" })] });
    const keptOne = afterWent({ payments: [payment({ status: "received" })] });
    const backOne = afterWent({ payments: [payment({ status: "refunded" })] });
    expect(settleOffer(sentOne, sentOne.plan, "aaron")).toEqual({ kind: "waiting" });
    expect(settleOffer(keptOne, keptOne.plan, "aaron")).toEqual({ kind: "settled", amount: 15 });
    expect(settleOffer(backOne, backOne.plan, "aaron")).toMatchObject({ kind: "ready", cap: 30 });
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

  it("asks for the other half only after the event, as the last card, and never while a payment waits", () => {
    for (const state of ["awaiting_humans", "confirmed", "scheduled", "reminded"] as const) {
      expect(kinds(viewForRole(at(state), "a").items)).not.toContain("settle-card");
    }
    // Followed up, but the person has not answered "How did it go?" yet: still nothing owed.
    const asked = at("followed_up");
    expect(kinds(viewForRole({ ...asked, plan: { ...asked.plan!, outcome: null } }, "a").items)).not.toContain("settle-card");
    const view = viewForRole(afterWent(), "a").items;
    expect(kinds(view)).toContain("settle-card");
    expect(kinds(viewForRole(afterWent(), "b").items)).toContain("settle-card");
    // After the outcome reply, never before it, and nothing with buttons below it. The next idea and the
    // closing line wait until after the money, so the chat ends on what to do next.
    const settle = view.findIndex((item) => item.kind === "settle-card");
    expect(view.findIndex((item) => item.kind === "bubble" && item.id === "outcome-reply")).toBeLessThan(settle);
    expect(view.findIndex((item) => item.id === "next-idea")).toBeGreaterThan(settle);
    expect(view.at(-1)).toMatchObject({ id: "closing" });
    const paid = viewForRole(afterWent({ payments: [payment()] }), "a").items;
    expect(paid.findIndex((item) => item.id === "next-idea")).toBeGreaterThan(paid.findIndex((item) => item.kind === "payment-card"));
    expect(view.slice(settle + 1).filter((item) => ["plan-card", "draft-card", "hold-row", "outcome-replies", "payment-card"].includes(item.kind))).toEqual([]);
    expect(view[settle]).toMatchObject({ museName: "Sprout" });
    expect(kinds(viewForRole(afterWent({ payments: [payment()] }), "a").items)).not.toContain("settle-card");
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
