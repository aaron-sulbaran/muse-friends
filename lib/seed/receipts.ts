import type { AgentId } from "@/lib/protocol";

// A seeded receipt for the payments demo: dinner at Shawarma Point, paid by Mochi the night before. It is a fixture,
// labeled seeded and fictional here, in what read_receipt returns, and in the Activity row it writes; it is never
// implied to be a real receipt. Whole dollars, and every line adds up: 13 + 11 + 2 + 4 = 30.

export type ReceiptLine = { n: number; item: string; amount: number; orderedBy: AgentId };

export type Receipt = {
  id: string;
  place: string;
  area: string;
  date: string;
  // Whose card paid the bill: the other person owes them their share.
  paidBy: AgentId;
  lines: ReceiptLine[];
  tax: number;
  tip: number;
  total: number;
  provenance: { source: "seeded"; fictional: true; note: string };
};

export const SHAWARMA_RECEIPT: Receipt = {
  id: "rcpt_shawarma_seeded",
  place: "Shawarma Point",
  area: "E 6th St",
  date: "2026-10-24",
  paidBy: "lisa",
  lines: [
    { n: 1, item: "Chicken shawarma plate", amount: 13, orderedBy: "aaron" },
    { n: 2, item: "Falafel plate", amount: 11, orderedBy: "lisa" },
  ],
  tax: 2,
  tip: 4,
  total: 30,
  provenance: { source: "seeded", fictional: true, note: "A seeded demo receipt, not a real one." },
};

export const RECEIPTS: Receipt[] = [SHAWARMA_RECEIPT];

// The receipt for a plan's place, or one named by id.
export function findReceipt(input: { place?: string; id?: string }): Receipt | null {
  if (input.id) return RECEIPTS.find((receipt) => receipt.id === input.id) ?? null;
  const place = (input.place ?? "").toLowerCase();
  return place ? (RECEIPTS.find((receipt) => place.includes(receipt.place.toLowerCase())) ?? null) : null;
}
