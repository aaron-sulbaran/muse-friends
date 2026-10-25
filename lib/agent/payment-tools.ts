import { z } from "zod";
import type { ToolDefinition, ToolHandler } from "@/lib/model";
import { DeclineArgs, PaymentIdArgs, ReadReceiptArgs, SendMoneyArgs, acceptPayment, declinePayment, getWallet, readReceipt, sendMoney, type PaymentContext } from "./payments";

// The four money tools. They are offered only in payment turns (a settle turn, or a friend's payment arriving),
// never in the negotiation turns, so the plan-making flow is exactly what it was.

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const converted = z.toJSONSchema(schema, { target: "draft-07" }) as Record<string, unknown>;
  delete converted.$schema;
  return converted;
}

export type PaymentToolName = "get_wallet" | "read_receipt" | "send_money" | "accept_payment" | "decline_payment";

const ALL: Record<PaymentToolName, ToolDefinition> = {
  get_wallet: {
    name: "get_wallet",
    description: "Your person's wallet: the balance, which sandbox it lives in, the most your person lets you send for this plan, and how much of that is already sent.",
    parameters: jsonSchema(z.strictObject({})),
  },
  read_receipt: {
    name: "read_receipt",
    description: "Read the receipt for this plan's place: its lines, who ordered each, tax, tip, total, and who paid the bill. It is a seeded, fictional receipt and says so. Its result includes a callId you can cite as the source of a breakdown line.",
    parameters: jsonSchema(ReadReceiptArgs),
  },
  send_money: {
    name: "send_money",
    description:
      "Prepare a payment of whole dollars from your person's wallet to your friend's wallet, with a breakdown whose lines add up to the amount and each name their source. It is checked against your person's cap and your balance, then shown to your person with the breakdown. NO money moves until they confirm; you cannot send it yourself. Your friend's agent hears about it only after they confirm.",
    parameters: jsonSchema(SendMoneyArgs),
  },
  accept_payment: {
    name: "accept_payment",
    description: "Accept a payment your friend's agent sent: the money is deposited into your person's wallet and your friend's agent is told the new balance.",
    parameters: jsonSchema(PaymentIdArgs),
  },
  decline_payment: {
    name: "decline_payment",
    description: "Decline a payment: the money goes straight back to your friend's wallet as a refund and your friend's agent is told.",
    parameters: jsonSchema(DeclineArgs),
  },
};

export function buildPaymentTools(ctx: PaymentContext, names: PaymentToolName[]): { tools: ToolDefinition[]; handlers: Record<string, ToolHandler> } {
  const handlers: Record<string, ToolHandler> = {
    get_wallet: async () => getWallet(ctx),
    read_receipt: (args, meta) => readReceipt(ctx, args, meta),
    send_money: (args, meta) => sendMoney(ctx, args, meta),
    accept_payment: (args, meta) => acceptPayment(ctx, args, meta),
    decline_payment: (args, meta) => declinePayment(ctx, args, meta),
  };
  return {
    tools: names.map((name) => ALL[name]),
    handlers: Object.fromEntries(names.map((name) => [name, handlers[name]])),
  };
}
