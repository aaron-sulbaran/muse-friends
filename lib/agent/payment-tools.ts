import { z } from "zod";
import type { ToolDefinition, ToolHandler } from "@/lib/model";
import { DeclineArgs, PaymentIdArgs, SendMoneyArgs, acceptPayment, declinePayment, getWallet, sendMoney, type PaymentContext } from "./payments";

// The four money tools. They are offered only in payment turns (a settle turn, or a friend's payment arriving),
// never in the negotiation turns, so the plan-making flow is exactly what it was.

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const converted = z.toJSONSchema(schema, { target: "draft-07" }) as Record<string, unknown>;
  delete converted.$schema;
  return converted;
}

export type PaymentToolName = "get_wallet" | "send_money" | "accept_payment" | "decline_payment";

const ALL: Record<PaymentToolName, ToolDefinition> = {
  get_wallet: {
    name: "get_wallet",
    description: "Your person's wallet: the balance, which sandbox it lives in, the most your person lets you send for this plan, and how much of that is already sent.",
    parameters: jsonSchema(z.strictObject({})),
  },
  send_money: {
    name: "send_money",
    description: "Send whole dollars from your person's wallet to your friend's wallet. Checked against your person's cap and your balance; the money moves at once. Your friend's agent then accepts it or sends it back.",
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
    send_money: (args, meta) => sendMoney(ctx, args, meta),
    accept_payment: (args, meta) => acceptPayment(ctx, args, meta),
    decline_payment: (args, meta) => declinePayment(ctx, args, meta),
  };
  return {
    tools: names.map((name) => ALL[name]),
    handlers: Object.fromEntries(names.map((name) => [name, handlers[name]])),
  };
}
