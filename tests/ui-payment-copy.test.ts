import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettleCard } from "@/components/SettleCard";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { copy } from "@/lib/ui/copy";
import { paymentSummary, settleDetailFor, settleOffer } from "@/lib/ui/payments";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import type { UiPayment } from "@/lib/ui/types";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

describe("the settle card's sentence", () => {
  it("says what is being settled and that the person is asked first, never that the Muse decides", () => {
    const line = settleDetailFor({ cap: 20, event: "Shawarma Point, Tue Oct 27", friendMuse: "Mochi" });
    expect(line).toBe("Your Muse works out your share of Shawarma Point, Tue Oct 27 and asks you before anything is sent, up to $20. Mochi accepts it or sends it back.");
    expect(line).not.toContain("decides");
    expect(settleDetailFor({ cap: 20, event: null, friendMuse: "Mochi" })).toBe("Your Muse works out your share and asks you before anything is sent, up to $20. Mochi accepts it or sends it back.");
  });

  it("is on the card: the offer carries the event, and the card shows the sentence", () => {
    const snapshot = toUiSnapshot(snapshotAtPlanState("scheduled"), { mode: "live" });
    const withMoney = {
      ...snapshot,
      payments: [],
      paymentsScope: { aaron: { enabled: true, cap: 20 }, lisa: { enabled: false, cap: 0 } },
      sandbox: { enabled: true, connected: true, text: "Capital One Nessie sandbox" },
    };
    const offer = settleOffer(withMoney, withMoney.plan, "aaron");
    expect(offer.kind).toBe("ready");
    if (offer.kind !== "ready") return;
    expect(offer.event).toMatch(/, (Mon|Tue|Wed|Thu|Fri|Sat|Sun) [A-Z][a-z]{2} \d{1,2}$/);
    const html = renderToStaticMarkup(
      createElement(SettleCard, { planId: "p", role: "a", offer, friendName: "Michelle", friendMuse: "Mochi", paymentCount: 0, readOnly: false, onChanged: () => {}, onOpenSettings: () => {} }),
    );
    expect(text(html)).toContain(`Your Muse works out your share of ${offer.event}`);
    expect(text(html)).not.toContain("decides what is fair");
  });
});

describe("the drawer's plain line", () => {
  const names = { aaron: "Sprout", lisa: "Mochi" };
  const payment: UiPayment = {
    id: "pay_1",
    planId: "plan_1",
    from: "aaron",
    to: "lisa",
    amount: 15,
    reason: "Dinner share",
    description: "Shawarma Point, Tue Oct 27, dinner share",
    status: "received",
    source: "nessie",
    at: "2026-10-27T20:00:00-05:00",
  };

  it("says who paid whom, how much, what for and where it stands, ahead of the JSON", () => {
    expect(paymentSummary(payment, names)).toBe("Sprout sent Mochi $15 for Shawarma Point, Tue Oct 27, dinner share. Mochi kept it.");
    expect(paymentSummary({ ...payment, status: "sent" }, names)).toContain("Waiting on Mochi.");
    expect(paymentSummary({ ...payment, status: "refunded" }, names)).toContain("Mochi sent it back.");
  });

  it("adds the receipt and the split when the agent recorded them, and the plain reason when no description was built", () => {
    expect(paymentSummary(payment, names, { receiptTotal: 30, ways: 2 })).toBe(
      "Sprout sent Mochi $15 for Shawarma Point, Tue Oct 27, dinner share. Mochi kept it. Receipt $30, split two ways.",
    );
    expect(paymentSummary({ ...payment, description: undefined }, names)).toContain("for Dinner share.");
  });
});

describe("the payment and handoff strings", () => {
  it("never use an em dash or an emoji", () => {
    const mine = Object.entries(copy).filter(([key]) => /^(payment|settle|wallet|draft|hold|changePlans)/.test(key));
    expect(mine.length).toBeGreaterThan(20);
    const values = mine.flatMap(([, value]) => (typeof value === "function" ? [(value as (...args: string[]) => string)("A", "B", "C")] : [value]));
    for (const value of values) {
      expect(value).not.toMatch(/\u2014|\u2013/);
      expect(value).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });
});
