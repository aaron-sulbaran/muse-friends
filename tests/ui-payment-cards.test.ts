import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaymentCard } from "@/components/PaymentCard";
import { PaymentsSection } from "@/components/PaymentsSection";
import { ConfirmSheet } from "@/components/payments/ConfirmSheet";
import { HoldToConfirm } from "@/components/payments/HoldToConfirm";
import { ProvenanceSheet } from "@/components/payments/ProvenanceSheet";
import { copy } from "@/lib/ui/copy";
import {
  breakdownAddsUp,
  breakdownTotal,
  cardVariant,
  confirmFacts,
  HOLD_MS,
  holdProgress,
  ledgerLine,
  provenanceRows,
  provenanceTag,
  roleOfAgent,
  signedDollars,
  toolsCalled,
} from "@/lib/ui/payment-card";
import { settleDetailFor, settleOffer } from "@/lib/ui/payments";
import type { UiBreakdownLine, UiPayment } from "@/lib/ui/types";

const lines: UiBreakdownLine[] = [
  { label: "Your plate, chicken shawarma", amount: 13, source: "call_1", sourceKind: "tool", tool: "read_receipt" },
  { label: "Half of tax", amount: 1, source: "call_1", sourceKind: "tool", tool: "read_receipt" },
  { label: "Half of tip", amount: 2, source: "call_1", sourceKind: "tool", tool: "read_receipt" },
];

function payment(over: Partial<UiPayment> = {}): UiPayment {
  return {
    id: "pay_1",
    planId: "plan_1",
    from: "aaron",
    to: "lisa",
    amount: 16,
    reason: "Your plate, plus half of tax and tip",
    status: "proposed",
    source: "nessie",
    breakdown: lines,
    receipt: { seeded: true, place: "Shawarma Point", total: 30 },
    confirmUrl: "/api/payments/pay_1/confirm",
    declineUrl: "/api/payments/pay_1/decline",
    toolCalls: [
      { name: "read_receipt", args: "", result: "" },
      { name: "get_wallet", args: "", result: "" },
      { name: "read_receipt", args: "", result: "" },
    ],
    at: "2026-10-25T04:10:00-05:00",
    ...over,
  };
}

describe("which card for which state", () => {
  it("follows the payment's state on the payer's phone", () => {
    for (const status of ["proposed", "failed", "declined", "sent", "received", "refunded"] as const) {
      expect(cardVariant(payment({ status }), "payer")).toBe(status);
    }
  });

  it("shows the friend nothing until money has moved", () => {
    for (const status of ["proposed", "failed", "declined"] as const) expect(cardVariant(payment({ status }), "payee")).toBeNull();
    for (const status of ["sent", "received", "refunded"] as const) expect(cardVariant(payment({ status }), "payee")).toBe(status);
  });

  it("lets the plan's Settle up card wait while a proposal is open, as the server does", () => {
    const base = { paymentsScope: { aaron: { enabled: true, cap: 30 }, lisa: { enabled: false, cap: 0 } }, sandbox: { enabled: true, connected: true, text: "x" } };
    const plan = { id: "plan_1", state: "followed_up" as const, outcome: { result: "went" as const, at: "2026-10-28T09:00:00-05:00", nextIdeaId: null, chosenBy: null } };
    for (const status of ["proposed", "failed", "sent"] as const) {
      expect(settleOffer({ ...base, payments: [payment({ status })] }, plan, "aaron")).toEqual({ kind: "waiting" });
    }
    for (const status of ["declined", "refunded"] as const) {
      expect(settleOffer({ ...base, payments: [payment({ status })] }, plan, "aaron").kind).toBe("ready");
    }
  });

  it("calls the plan settled once the friend kept the money, on both phones, so the ready card does not come back", () => {
    const base = { paymentsScope: { aaron: { enabled: true, cap: 30 }, lisa: { enabled: true, cap: 30 } }, sandbox: { enabled: true, connected: true, text: "x" } };
    const plan = { id: "plan_1", state: "followed_up" as const, outcome: { result: "went" as const, at: "2026-10-28T09:00:00-05:00", nextIdeaId: null, chosenBy: null } };
    const kept = { ...base, payments: [payment({ status: "received", amount: 16 })] };
    expect(settleOffer(kept, plan, "aaron")).toEqual({ kind: "settled", amount: 16 });
    expect(settleOffer(kept, plan, "lisa")).toEqual({ kind: "settled", amount: 16 });
    // Another plan's payment says nothing about this one.
    expect(settleOffer({ ...base, payments: [payment({ status: "received", planId: "plan_2" })] }, plan, "aaron").kind).toBe("ready");
  });
});

describe("the breakdown", () => {
  it("adds up to the amount, with a deduction counted as negative", () => {
    expect(breakdownTotal(lines)).toBe(16);
    expect(breakdownAddsUp(payment())).toBe(true);
    expect(breakdownAddsUp(payment({ amount: 17 }))).toBe(false);
    expect(breakdownTotal([...lines, { label: "Your coupon", amount: -2, source: "note", sourceKind: "note" }])).toBe(14);
    expect(signedDollars(-2)).toBe("-$2");
    expect(signedDollars(13)).toBe("$13");
  });

  it("shows a row only when it has a source, each tagged with where it came from", () => {
    const rows = provenanceRows(
      payment({
        breakdown: [...lines, { label: "Mystery", amount: 0, source: "", sourceKind: "estimate" }, { label: "Dessert", amount: 3, source: "estimate", sourceKind: "estimate" }, { label: "Plate", amount: 2, source: "note", sourceKind: "note" }],
      }),
    );
    expect(rows.map((row) => row.label)).toEqual(["Your plate, chicken shawarma", "Half of tax", "Half of tip", "Dessert", "Plate"]);
    expect(rows[0]).toEqual({ label: "Your plate, chicken shawarma", amount: "$13", tag: "Seeded receipt, read with read_receipt" });
    expect(rows[3].tag).toBe("Your Muse's estimate");
    expect(rows[4].tag).toBe("Your note");
  });

  it("names a tool line honestly when the receipt was not the source", () => {
    expect(provenanceTag({ label: "x", amount: 1, source: "c", sourceKind: "tool", tool: "get_wallet" }, payment({ receipt: undefined }))).toBe("Read with get_wallet");
    expect(provenanceTag({ label: "x", amount: 1, source: "c", sourceKind: "tool" }, payment())).toBe("A tool call from this turn");
  });

  it("lists the tools called once each, in order", () => {
    expect(toolsCalled(payment())).toEqual(["read_receipt", "get_wallet"]);
    expect(toolsCalled(payment({ toolCalls: undefined }))).toEqual([]);
  });

  it("says send_money only prepared a payment until the person has confirmed it", () => {
    const calls = [{ name: "get_wallet", args: "", result: "" }, { name: "read_receipt", args: "", result: "" }, { name: "send_money", args: "", result: "" }];
    expect(toolsCalled(payment({ status: "proposed", toolCalls: calls }))).toEqual(["get_wallet", "read_receipt", "send_money (prepared, waits for you)"]);
    expect(toolsCalled(payment({ status: "failed", toolCalls: calls })).at(-1)).toBe("send_money (prepared, nothing moved)");
    expect(toolsCalled(payment({ status: "declined", toolCalls: calls })).at(-1)).toBe("send_money (prepared, not sent)");
    for (const status of ["sent", "received", "refunded"] as const) expect(toolsCalled(payment({ status, toolCalls: calls })).at(-1)).toBe("send_money");
  });

  it("shows that label in the sheet's footer while the payment is waiting", () => {
    const calls = [{ name: "send_money", args: "", result: "" }];
    const waiting = text(renderToStaticMarkup(createElement(ProvenanceSheet, { payment: payment({ status: "proposed", toolCalls: calls }), onClose: () => {} })));
    expect(waiting).toContain("Tools called: send_money (prepared, waits for you)");
    const sent = text(renderToStaticMarkup(createElement(ProvenanceSheet, { payment: payment({ status: "sent", toolCalls: calls }), onClose: () => {} })));
    expect(sent).toContain("Tools called: send_money");
    expect(sent).not.toContain("prepared");
  });

  it("gives the ledger ids only once something was sent", () => {
    expect(ledgerLine(payment())).toBe(copy.provenanceLedgerLater);
    expect(ledgerLine(payment({ status: "received", withdrawalId: "wd_1", depositId: "dep_1" }))).toBe("Ledger: withdrawal wd_1, deposit dep_1");
    expect(ledgerLine(payment({ status: "sent", withdrawalId: "wd_1" }))).toBe("Ledger: withdrawal wd_1");
  });
});

describe("the confirm step", () => {
  it("shows the wallet before and after, and the cap", () => {
    expect(confirmFacts({ amount: 16 }, { balance: 120 }, 30)).toEqual({ wallet: "$120 to $104", cap: "$30" });
    expect(confirmFacts({ amount: 16 }, null, 30).wallet).toBeNull();
    expect(confirmFacts({ amount: 16 }, { balance: 120 }, 0).cap).toBeNull();
  });

  it("fills over 0.8 seconds and sends only at full", () => {
    expect(HOLD_MS).toBe(800);
    expect(holdProgress(0)).toBe(0);
    expect(holdProgress(400)).toBe(0.5);
    expect(holdProgress(799)).toBeLessThan(1);
    expect(holdProgress(800)).toBe(1);
    expect(holdProgress(5000)).toBe(1);
    expect(holdProgress(-20)).toBe(0);
  });

  it("maps a seat to the role the routes take", () => {
    expect(roleOfAgent("aaron")).toBe("a");
    expect(roleOfAgent("lisa")).toBe("b");
  });
});

describe("the settle card now that nothing moves without the person", () => {
  it("promises to ask first, never that the Muse sends on its own", () => {
    const line = settleDetailFor({ kind: "ready", place: "Shawarma Point", friendMuse: "Michelle's Muse", museName: "Sprout" });
    expect(line).toBe("Michelle's Muse sent the receipt from Shawarma Point and is asking for your half. Sprout can prepare it for you to confirm.");
    expect(line).not.toContain("without asking");
    expect(settleDetailFor({ kind: "ready", place: null, friendMuse: "Mochi", museName: "Sprout" })).toContain("sent the receipt and is asking for your half");
  });
});

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const card = (over: Partial<UiPayment>, side: "payer" | "payee" = "payer") =>
  renderToStaticMarkup(createElement(PaymentCard, { payment: payment(over), side, friendName: "Michelle", friendMuse: "Mochi" }));

describe("the cards, state by state", () => {
  it("proposed: the amount, the way it was worked out, and two choices, with nothing sent", () => {
    const html = card({});
    const words = text(html);
    expect(words).toContain("Pay Michelle back");
    expect(words).toContain("$16");
    expect(words).toContain("How your Muse worked this out");
    expect(words).toContain("Not now");
    expect(words).toContain("Review and send");
    expect(words).toContain("Why $16?");
    expect(words).not.toContain("You sent");
  });

  it("failed: the amount struck through, nothing moved, and a way to try again", () => {
    const html = card({ status: "failed", error: "The sandbox did not answer." });
    expect(html).toContain("line-through");
    expect(text(html)).toContain("Didn't go through. Nothing moved.");
    expect(text(html)).toContain("The sandbox did not answer.");
    expect(text(html)).toContain("Try again");
    expect(text(html)).not.toContain("Why $16?");
  });

  it("declined: a quiet note that nothing moved, with no buttons", () => {
    const words = text(card({ status: "declined" }));
    expect(words).toContain("Not sent. Nothing moved.");
    expect(words).not.toContain("Review and send");
  });

  it("sent, received: the amount in the title and where it stands", () => {
    expect(text(card({ status: "sent", withdrawalId: "wd_1" }))).toContain("You sent Michelle $16");
    expect(text(card({ status: "sent", withdrawalId: "wd_1" }))).toContain("Waiting on Mochi");
    expect(text(card({ status: "received" }))).toContain("Michelle has it");
  });

  it("refunded: the amount struck through and sent back to you", () => {
    const html = card({ status: "refunded" });
    expect(html).toContain("<s ");
    expect(text(html)).toContain("Sent back to you");
  });

  it("on the friend's phone: nothing for a proposal, the same facts once money moved", () => {
    expect(card({}, "payee")).toBe("");
    expect(card({ status: "declined" }, "payee")).toBe("");
    expect(text(card({ status: "received", balanceBefore: 80, balanceAfter: 96 }, "payee"))).toContain("Michelle sent you $16");
    expect(text(card({ status: "received", balanceBefore: 80, balanceAfter: 96 }, "payee"))).toContain("Kept. Your balance went from $80 to $96");
    expect(text(card({ status: "received" }, "payee"))).toContain("How Mochi worked this out");
  });
});

describe("the sheets", () => {
  it("the how-it-was-worked-out sheet lists every sourced line, the total, the tools and the paper-dollar line", () => {
    const words = text(renderToStaticMarkup(createElement(ProvenanceSheet, { payment: payment({ explanation: "Your plate: $13. You send $16." }), onClose: () => {} })));
    expect(words).toContain("How your Muse worked out $16");
    expect(words).toContain("Every line says where it came from.");
    expect(words).toContain("Your plate, chicken shawarma");
    expect(words).toContain("Seeded receipt, read with read_receipt");
    expect(words).toContain("You send $16");
    expect(words).toContain("Receipt total $30, a seeded receipt, fictional");
    expect(words).toContain("Tools called: read_receipt, get_wallet");
    expect(words).toContain("Ledger ids appear here after you send.");
    expect(words).toContain("Paper dollars in the Capital One sandbox. Not real money.");
    expect(words).toContain("Your plate: $13. You send $16.");
  });

  it("the confirm sheet names who gets it, the amount and the reason, and holds the send behind the pill", () => {
    const words = text(renderToStaticMarkup(createElement(ConfirmSheet, { payment: payment({ description: "Shawarma Point, Tue Oct 27, your share" }), friendName: "Michelle", onClose: () => {} })));
    expect(words).toContain("Send to Michelle");
    expect(words).toContain("$16");
    expect(words).toContain("Shawarma Point, Tue Oct 27, your share");
    expect(words).toContain("Hold to send $16");
    expect(words).toContain("Cancel");
  });

  it("the hold is a button that needs pressing and holding, never a plain click handler", () => {
    const html = renderToStaticMarkup(createElement(HoldToConfirm, { amount: "$16", friend: "Michelle", onConfirm: () => {} }));
    expect(html).toContain('aria-label="Hold to send $16"');
    expect(html).not.toContain("onclick");
  });

  it("the payments switch promises the Muse still asks first", () => {
    const html = renderToStaticMarkup(createElement(PaymentsSection, { role: "a", settings: { enabled: true, cap: 20 }, onChanged: () => {} }));
    expect(text(html)).toContain("Your Muse still asks you before every payment.");
  });
});
