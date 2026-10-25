import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentCard } from "@/components/PaymentCard";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { describeNote, describePayment, eventLabel, formatPlanDay } from "@/lib/ui/payments";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import type { UiPayment, UiPlan } from "@/lib/ui/types";

const window = { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" };
const plan: Pick<UiPlan, "activityTitle" | "window"> = { activityTitle: "Shawarma Point", window };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

describe("naming the event and its day", () => {
  it("writes the weekday and date the plan's window starts, in Central", () => {
    expect(formatPlanDay(window)).toBe("Tue Oct 27");
    // 11:30pm Central is already the next day in UTC; the label stays on the Central day.
    expect(formatPlanDay({ start: "2026-10-27T23:30:00-05:00", end: "2026-10-28T00:30:00-05:00" })).toBe("Tue Oct 27");
  });

  it("labels the event by title and day, and by title alone when the plan has no window", () => {
    expect(eventLabel(plan)).toBe("Shawarma Point, Tue Oct 27");
    expect(eventLabel({ activityTitle: "Shawarma Point", window: null })).toBe("Shawarma Point");
  });
});

describe("a payment's description", () => {
  it("leads with the event and the day, then what the money was for", () => {
    expect(describePayment("Dinner share", plan)).toBe("Shawarma Point, Tue Oct 27, dinner share");
    expect(describePayment("Covering the shawarma plate", plan)).toBe("Shawarma Point, Tue Oct 27, covering the shawarma plate");
  });

  it("keeps a name's capital letter", () => {
    expect(describePayment("Michelle's half of the plate", plan)).toBe("Shawarma Point, Tue Oct 27, Michelle's half of the plate");
  });

  it("does not say the event twice when the reason already names it", () => {
    expect(describePayment("Shawarma Point dinner share", plan)).toBe("Shawarma Point dinner share, Tue Oct 27");
  });

  it("falls back to the reason alone with no plan, and never invents an event", () => {
    expect(describePayment("Dinner share", null)).toBe("Dinner share");
  });
});

describe("the payment card", () => {
  const payment: UiPayment = {
    id: "pay_1",
    planId: "plan_1",
    from: "aaron",
    to: "lisa",
    amount: 15,
    reason: "Dinner share",
    status: "sent",
    source: "nessie",
    at: "2026-10-27T20:00:00-05:00",
  };
  const render = (over: Partial<UiPayment>) =>
    text(renderToStaticMarkup(createElement(PaymentCard, { payment: { ...payment, ...over }, side: "payer", friendName: "Michelle", friendMuse: "Mochi" })));

  it("carries the event and the day in the line under You sent Michelle $15", () => {
    const line = render({ description: "Shawarma Point, Tue Oct 27, dinner share" });
    expect(line).toContain("You sent Michelle $15");
    expect(line).toContain("Shawarma Point, Tue Oct 27, dinner share");
  });

  it("falls back to the reason when the description was not built", () => {
    expect(render({})).toContain("Dinner share");
  });
});


describe("the snapshot", () => {
  const payment: UiPayment = {
    id: "pay_1",
    planId: "plan_1",
    from: "aaron",
    to: "lisa",
    amount: 15,
    reason: "Dinner share",
    description: "Shawarma Point, Tue Oct 27, dinner share",
    status: "sent",
    source: "nessie",
    withdrawalId: "wd_1",
    at: "2026-10-27T20:00:00-05:00",
  };

  it("names the event and the day in the Activity row, keeping the ledger ids", () => {
    const text = "Sprout's Muse sent $15 to Mochi's Muse: Dinner share (Nessie sandbox, withdrawal wd_1)";
    expect(describeNote(text, [payment])).toBe("Sprout's Muse sent $15 to Mochi's Muse: Shawarma Point, Tue Oct 27, dinner share (Nessie sandbox, withdrawal wd_1)");
  });

  it("leaves a row it cannot match to a payment exactly as the agent wrote it", () => {
    const other = "Sprout's Muse sent $15 to Mochi's Muse: Dinner share (Nessie sandbox, withdrawal wd_9)";
    expect(describeNote(other, [payment])).toBe(other);
    expect(describeNote("Payment failed, sandbox error: nope", [payment])).toBe("Payment failed, sandbox error: nope");
  });

  it("gives every payment in a built snapshot a description from its plan", () => {
    const state = snapshotAtPlanState("scheduled");
    const planId = state.plans.at(-1)!.id;
    const message = { ...state.messages[0].message, id: "msg_pay", type: "payment" as const, seq: state.messages.length + 1, reason: "settle_up" as const, payment: { paymentId: "pay_test", planId, amount: 15, currency: "USD" as const, reason: "Dinner share", source: "nessie" as const, payerAccountId: "acct_a", withdrawalId: "wd_test" } };
    const built = toUiSnapshot({ ...state, messages: [...state.messages, { ...state.messages[0], message }] }, { mode: "live" });
    expect(built.payments).toHaveLength(1);
    expect(built.payments[0].description).toMatch(/^.+, (Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} \d{1,2}, dinner share$/);
  });
});
