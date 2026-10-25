// One-line summaries of tool calls, for the proof that rides on a message ("Tools called" in the drawer). They are
// derived from what a tool was asked and what it answered, but they never carry content: a calendar's busy titles,
// the wallet's balance, a caption's text, or a friend's note stay out. Counts, dates, and the shape of the call are
// enough to show an agent actually used its tools. The model never sees any of this.

export type ToolCallSummary = { name: string; args: string; result: string };

const NAME_MAX = 40;
const LINE_MAX = 100;

function oneLine(text: string, max = LINE_MAX): string {
  const flat = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");
const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

// Only the date part of a time the model wrote, so a stray note in the argument cannot ride along.
const day = (value: unknown): string => (/^\d{4}-\d{2}-\d{2}/.test(text(value)) ? text(value).slice(0, 10) : "");

function argsLine(name: string, args: unknown): string {
  const a = record(args);
  switch (name) {
    case "get_my_calendar":
      return day(a.start) && day(a.end) ? `${day(a.start)} to ${day(a.end)}` : "";
    case "get_interests":
      return text(a.category) || "all";
    case "read_signal":
      return "";
    case "record_reel_details":
      return text(a.place) ? `place ${text(a.place)}${text(a.area) ? `, ${text(a.area)}` : ""}` : "";
    case "send_to_friend_agent": {
      const windows = count(a.windows);
      const share = Array.isArray(a.share) && a.share.length > 0 ? `, share ${a.share.filter((entry) => typeof entry === "string").join("+")}` : "";
      return `${text(a.type) || "message"}${windows > 0 ? `, ${plural(windows, "window")}` : ""}${share}`;
    }
    case "get_wallet":
      return "";
    case "send_money":
      return `$${typeof a.amount === "number" ? a.amount : "?"} to ${text(a.to) || "friend"}`;
    case "accept_payment":
    case "decline_payment":
      return text(a.paymentId);
    default:
      return "";
  }
}

function resultLine(name: string, output: unknown, ok: boolean): string {
  const o = record(output);
  if (!ok) return `error: ${oneLine(text(o.error) || "failed", 80)}`;
  switch (name) {
    case "get_my_calendar":
      return `${plural(count(o.free), "free block")}, ${count(o.busy)} busy`;
    case "get_interests": {
      const total = Object.values(o).reduce<number>((sum, entry) => sum + count(entry), 0);
      return plural(total, "interest");
    }
    case "read_signal":
      return text(o.from) ? `reel from ${text(o.from)}` : "reel read";
    case "record_reel_details":
      return "saved";
    case "send_to_friend_agent":
      return typeof o.seq === "number" ? `message #${o.seq} ${text(o.state) || "sent"}` : "sent";
    case "get_wallet":
      return "balance read";
    case "send_money":
      return typeof o.amount === "number" ? `withdrew $${o.amount}, payment sent` : "payment sent";
    case "accept_payment":
      return typeof o.amount === "number" ? `deposited $${o.amount}` : "accepted";
    case "decline_payment":
      return typeof o.amount === "number" ? `refunded $${o.amount}` : "declined";
    default:
      return "ok";
  }
}

export function summarizeToolCall(call: { name: string; args: unknown; output: unknown; ok: boolean }): ToolCallSummary {
  return { name: oneLine(call.name, NAME_MAX), args: oneLine(argsLine(call.name, call.args)), result: oneLine(resultLine(call.name, call.output, call.ok)) };
}
