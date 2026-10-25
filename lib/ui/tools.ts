/*
 * The tools a model call used: each as a name, a one-line summary of what it was called with, and a one-line
 * summary of what it returned. The store's proof may carry them as `toolCalls`; when it does not, nothing about
 * tools is shown rather than an empty list. The JSON drawer shows them raw; Activity shows them as plain words
 * (`toolLine`), with the pages a web search found as host chips (`sourcesOf`).
 */

import { categoryLabel } from "./tokens";
import { formatWindowList, listOf } from "./format";
import type { Category, UiMessage, UiSource } from "./types";

export type UiToolCall = { name: string; args: string; result: string; /** Pages a search found, https only; absent when there are none. */ sources?: UiSource[] };

const MAX_LINE = 140;

/** Anything as one readable line: whitespace collapsed, objects as JSON, long text cut with an ellipsis of dots. */
export function oneLine(value: unknown): string {
  const text = typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);
  const line = (text ?? "").replace(/\s+/g, " ").trim();
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 3).trimEnd()}...` : line;
}

const MAX_SOURCES = 3;

/**
 * The pages a search found, as chips: up to three, https only, one per host, `www.` dropped. Each entry is a url or
 * `{ url, title }` (the title falls back to the host); anything else is skipped. Third-party data, so it only ever
 * becomes a link to a real https page.
 */
export function sourcesOf(raw: unknown): UiSource[] {
  if (!Array.isArray(raw)) return [];
  const sources: UiSource[] = [];
  for (const entry of raw) {
    const found: { url?: unknown; title?: unknown } | null = typeof entry === "string" ? { url: entry } : (entry as { url?: unknown; title?: unknown } | null);
    const candidate = found?.url;
    if (typeof candidate !== "string") continue;
    let parsed: URL;
    try {
      parsed = new URL(candidate.trim());
    } catch {
      continue;
    }
    const host = parsed.hostname.replace(/^www\./, "");
    if (parsed.protocol !== "https:" || host === "" || sources.some((source) => source.host === host)) continue;
    const title = typeof found?.title === "string" ? oneLine(found.title) : "";
    sources.push({ title: title || host, url: parsed.href, host });
    if (sources.length === MAX_SOURCES) break;
  }
  return sources;
}

/** The tool calls on a message's proof, tolerant of the shape still settling; undefined when there are none to show. */
export function toolCallsOf(proof: unknown): UiToolCall[] | undefined {
  const raw = (proof as { toolCalls?: unknown } | null | undefined)?.toolCalls;
  if (!Array.isArray(raw)) return undefined;
  const calls = raw.flatMap((entry): UiToolCall[] => {
    const call = entry as { name?: unknown; args?: unknown; result?: unknown; sources?: unknown; links?: unknown } | null;
    if (typeof call?.name !== "string" || call.name.trim() === "") return [];
    const sources = sourcesOf(call.sources ?? call.links);
    return [{ name: call.name.trim(), args: oneLine(call.args), result: oneLine(call.result), ...(sources.length > 0 ? { sources } : {}) }];
  });
  return calls.length > 0 ? calls : undefined;
}

// ---------------------------------------------------------------------------
// Activity: each tool as one plain line
// ---------------------------------------------------------------------------

/** Who the lines are about, so a stored agent id or "the friend" reads as a name. */
export type ToolLineContext = {
  /** The Muse the message went to: "Michelle's Muse". */
  to: string;
  /** The person whose Muse made the calls, for "waiting for Aaron to confirm". */
  owner: string;
  /** What an agent id in a call's arguments is called in a sentence; anything unknown means the person it went to. */
  person: (agentId: string) => string;
};

/** What a chat answer's tool lines are said about: the chat's read tools send nothing, so only the wording of a name is needed. */
export const chatLineContext: ToolLineContext = { to: "your friend's Muse", owner: "you", person: () => "your friend" };

/**
 * A chat answer keeps the pages its search found on the answer, not on a call; this puts them on the first web_search
 * call that has none of its own, so the line that says what was searched carries the chips. Unchanged when there are no
 * pages or no search to hang them on.
 */
export function withSearchSources(calls: UiToolCall[] | undefined, sources: UiSource[] | undefined): UiToolCall[] | undefined {
  if (!calls || !sources || sources.length === 0) return calls;
  const index = calls.findIndex((call) => call.name === "web_search" && !call.sources);
  if (index === -1) return calls;
  return calls.map((call, at) => (at === index ? { ...call, sources: sources.slice(0, MAX_SOURCES) } : call));
}

/** A row shows this many lines at most; the rest sit behind "+n more". */
export const MAX_TOOL_LINES = 6;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const countIn = (line: string, pattern: RegExp): number | undefined => {
  const hit = line.match(pattern);
  return hit?.[1] === undefined ? undefined : Number(hit[1]);
};

/** "2026-10-25 to 2026-10-31" as "Oct 25 to Oct 31", the dates as written so no time zone can move them. */
function dateRange(args: string): string {
  const hit = args.match(/^(\d{4})-(\d{2})-(\d{2}) to (\d{4})-(\d{2})-(\d{2})$/);
  if (!hit) return args;
  const day = (month: string, date: string) => `${MONTHS[Number(month) - 1] ?? month} ${Number(date)}`;
  const start = day(hit[2]!, hit[3]!);
  const end = day(hit[5]!, hit[6]!);
  return start === end ? start : `${start} to ${end}`;
}

const SENT_AS: Record<string, string> = {
  intent: "an invite",
  propose: "a proposal",
  counter: "a counter",
  accept: "an acceptance",
  decline: "a decline",
  payment: "a payment",
  payment_received: "a deposit notice",
  payment_cancelled: "a payment cancellation",
  trip_ask: "a trip question",
  trip_answer: "a trip answer",
  trip_plan: "a trip plan",
  trip_reply: "a trip reply",
};

/** What a failed call could not do, in the same plain words the success line uses. */
function couldNot(name: string, context: ToolLineContext): string | undefined {
  switch (name) {
    case "get_my_calendar":
      return "check the calendar";
    case "get_interests":
      return "check interests";
    case "read_signal":
    case "get_reel":
      return "read the reel";
    case "record_reel_details":
      return "save the place";
    case "send_to_friend_agent":
      return `send the message to ${context.to}`;
    case "get_wallet":
    case "get_wallet_and_history":
      return "check the wallet";
    case "read_receipt":
      return "read the receipt";
    case "send_money":
      return "prepare the payment";
    case "accept_payment":
      return "accept the payment";
    case "decline_payment":
      return "send the payment back";
    case "web_search":
      return "search the web";
    default:
      return undefined;
  }
}

/**
 * One tool call as one line in plain words, from the name, the arguments and the result exactly as the store
 * recorded them (counts and the shape of the call, never content). A tool this does not know is shown as its raw
 * name and arguments rather than hidden.
 */
export function toolLine(call: UiToolCall, context: ToolLineContext): string {
  const { name, args, result } = call;
  const failure = result.startsWith("error:") ? result.replace(/^error:\s*/, "") : undefined;
  if (failure !== undefined) {
    const action = couldNot(name, context);
    if (action) return `Could not ${action}: ${failure}`;
    return `${args ? `${name}: ${args}` : name}, ${result}`;
  }
  switch (name) {
    case "read_signal":
    case "get_reel": {
      const from = result.match(/^reel from (.+)$/)?.[1];
      if (name === "get_reel" && result === "no reel yet") return "Looked for a reel, none yet";
      return from ? `Read the reel from ${from}` : "Read the reel";
    }
    case "record_reel_details":
      return args.startsWith("place ") ? `Saved the place: ${args.slice("place ".length)}` : "Saved the place from the reel";
    case "get_my_calendar":
      return `Checked the calendar${args ? ` for ${dateRange(args)}` : ""}: ${result}`;
    case "get_interests": {
      const found = countIn(result, /^(\d+) interests?$/);
      const label = args && args !== "all" ? `${categoryLabel[args as Category] ?? args} interests` : "interests";
      return `Checked ${label}: ${found === undefined ? result : found === 0 ? "none found" : `${found} found`}`;
    }
    case "send_to_friend_agent": {
      const parts = args.split(",").map((part) => part.trim());
      const windows = countIn(args, /(\d+) windows?/);
      const shared = args.match(/share ([^,]+)/)?.[1];
      const details = [
        windows === undefined ? "" : plural(windows, "time"),
        shared ? `sharing ${listOf(shared.split("+").map((category) => categoryLabel[category as Category] ?? category))}` : "",
      ].filter(Boolean);
      return `Sent ${SENT_AS[parts[0] ?? ""] ?? "a message"} to ${context.to}${details.length > 0 ? `: ${details.join(", ")}` : ""}`;
    }
    case "get_wallet":
      return "Checked the wallet";
    case "get_wallet_and_history": {
      const payments = countIn(result, /(\d+) payments?$/);
      if (result === "payments off") return "Checked the wallet, payments are off";
      return payments === undefined ? "Checked the wallet" : `Checked the wallet and ${plural(payments, "payment")}`;
    }
    case "read_receipt":
      return `Read the receipt${args ? ` for ${args}` : ""}`;
    case "send_money": {
      const hit = args.match(/^\$(\S+) to (\S+?)(?:, (\d+) lines?)?$/);
      const amount = hit?.[1] ?? "?";
      const lines = hit?.[3] === undefined ? "" : `, ${plural(Number(hit[3]), "line")}`;
      const to = context.person(hit?.[2] ?? "friend");
      return result.startsWith("prepared") ? `Prepared $${amount} for ${to}${lines}, waiting for ${context.owner} to confirm` : `Sent $${amount} to ${to}${lines}`;
    }
    case "accept_payment": {
      const amount = result.match(/^deposited \$(\S+)$/)?.[1];
      return amount ? `Accepted the payment and deposited $${amount}` : "Accepted the payment";
    }
    case "decline_payment": {
      const amount = result.match(/^refunded \$(\S+)$/)?.[1];
      return amount ? `Sent the payment back, refunded $${amount}` : "Sent the payment back";
    }
    case "get_plan":
      return result === "no plan yet" ? "Looked for a plan, none yet" : "Read the plan";
    case "get_sharing":
      return "Read the sharing settings";
    case "explain_payment": {
      const lines = countIn(result, /^(\d+) lines? explained$/);
      return lines === undefined ? "Looked up a payment, no breakdown recorded" : `Explained a payment, ${plural(lines, "line")}`;
    }
    case "where_to_do_that":
      return args ? `Pointed to the card: ${args.replace(/_/g, " ")}` : "Pointed to the card";
    case "web_search": {
      const found = countIn(result, /^(\d+) results?$/);
      const outcome = found === 0 ? "no results" : result;
      return `Searched the web${args ? ` for "${args}"` : ""}: ${outcome}`;
    }
    default:
      return args ? `${name}: ${args}` : name;
  }
}

export type ToolLineItem = { text: string; sources: UiSource[] };

/** The lines for a message's calls, in the order they ran. */
export function toolLines(calls: UiToolCall[] | undefined, context: ToolLineContext): ToolLineItem[] {
  return (calls ?? []).map((call) => ({ text: toolLine(call, context), sources: call.sources ?? [] }));
}

/**
 * The scheduling decision and why, from the message's own windows and reason (never the model's note, which the row
 * already quotes). Only a proposal, counter, accept or decline has one.
 */
export function whyLine(message: UiMessage): string | undefined {
  const windows = message.windows?.length ? formatWindowList(message.windows) : undefined;
  const free = message.reason === "both_free" ? ", free on both calendars" : "";
  switch (message.type) {
    case "propose":
      return windows ? `Proposed ${windows}${free}` : undefined;
    case "counter":
      return windows ? `Countered: offered ${windows}${free}` : "Countered: no new time offered";
    case "accept":
      return windows ? `Accepted ${windows}${free}` : "Accepted";
    case "decline":
      switch (message.reason) {
        case "no_overlap":
          return "Declined: no time works, no shared free time";
        case "not_interested":
          return "Declined: not interested";
        case "cap_reached":
          return "Declined: over the limit";
        default:
          return "Declined";
      }
    default:
      return undefined;
  }
}
