import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentHistory } from "@/components/PaymentHistory";
import { PaymentsSection } from "@/components/PaymentsSection";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { paymentHistory } from "@/lib/ui/history";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import type { UiPayment, UiSnapshot } from "@/lib/ui/types";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

function payment(over: Partial<UiPayment> = {}): UiPayment {
  return {
    id: "pay_1",
    planId: "plan_1",
    from: "aaron",
    to: "lisa",
    amount: 15,
    reason: "Dinner share",
    planLabel: "Shawarma Point, Tue Oct 27",
    status: "received",
    source: "nessie",
    at: "2026-10-25T04:10:00-05:00",
    ...over,
  };
}

const base = toUiSnapshot(snapshotAtPlanState("scheduled"), { mode: "live" });
const withPayments = (payments: UiPayment[], over: Partial<UiSnapshot> = {}): UiSnapshot => ({ ...base, simulatedFriend: true, payments, ...over });

describe("the wallet history", () => {
  it("is one row per payment, with who, why, when and the plan, newest first", () => {
    const [group] = paymentHistory(
      withPayments([payment(), payment({ id: "pay_2", amount: 8, reason: "Dessert", at: "2026-10-25T05:00:00-05:00", status: "sent" })]),
      "aaron",
    );
    expect(group.title).toBeNull();
    expect(group.rows.map((row) => row.id)).toEqual(["pay_2", "pay_1"]);
    expect(group.rows[1]).toEqual({
      id: "pay_1",
      who: "You sent Michelle $15",
      why: "Dinner share",
      when: "Sun Oct 25, 4:10 AM",
      plan: "Shawarma Point, Tue Oct 27",
      standing: "Kept",
    });
    expect(group.rows[0].standing).toBe("Waiting");
  });

  it("reads from the other seat's side too", () => {
    const [group] = paymentHistory(withPayments([payment()]), "lisa");
    expect(group.rows[0].who).toBe("Your friend sent you $15");
  });

  it("says a refunded payment was sent back", () => {
    const [group] = paymentHistory(withPayments([payment({ status: "refunded" })]), "aaron");
    expect(group.rows[0].standing).toBe("Sent back");
  });

  it("lists money that moved, not a proposal waiting, declined or failed", () => {
    const rows = paymentHistory(
      withPayments([payment({ id: "a", status: "proposed" }), payment({ id: "b", status: "declined" }), payment({ id: "c", status: "failed" }), payment({ id: "d", status: "sent" })]),
      "aaron",
    );
    expect(rows.flatMap((group) => group.rows.map((row) => row.id))).toEqual(["d"]);
  });

  it("leaves out payments between other people", () => {
    expect(paymentHistory(withPayments([payment({ from: "lisa", to: "lisa" })]), "aaron")).toEqual([]);
  });

  it("groups by friend as History with Michelle once more than one friend has a payment", () => {
    // A second friend: the grouping works on whoever the counterpart is, and Kai has a name in every room.
    const other = "kai" as unknown as UiPayment["to"];
    const groups = paymentHistory(withPayments([payment(), payment({ id: "pay_3", to: other, at: "2026-10-25T06:00:00-05:00" })]), "aaron");
    expect(groups.map((group) => group.title)).toEqual(["History with Kai", "History with Michelle"]);
    expect(groups[1].rows.map((row) => row.id)).toEqual(["pay_1"]);
  });

  it("renders the rows, and a plain line when there is nothing yet", () => {
    const html = renderToStaticMarkup(createElement(PaymentHistory, { groups: paymentHistory(withPayments([payment()]), "aaron") }));
    expect(text(html)).toContain("You sent Michelle $15");
    expect(text(html)).toContain("Shawarma Point, Tue Oct 27");
    expect(text(html)).toContain("Dinner share");
    expect(text(renderToStaticMarkup(createElement(PaymentHistory, { groups: [] })))).toContain("No payments yet");
  });
});

describe("the tabs in the wallet sheet", () => {
  it("puts Settings and History at the top right of the Payments section, with Settings selected first", () => {
    const html = renderToStaticMarkup(createElement(PaymentsSection, { role: "a", settings: { enabled: true, cap: 20 }, onChanged: () => {} }));
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Settings</);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*>History</);
    expect(text(html)).toContain("Let my Muse send money");
  });
});
