import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityRow } from "@/components/ActivityRow";
import { ToolLines } from "@/components/ToolLines";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { summarizeToolCall } from "@/lib/tool-summary";
import { discInitials, namesFor } from "@/lib/ui/format";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import { MAX_TOOL_LINES, sourcesOf, toolCallsOf, toolLine, toolLines, whyLine, withSearchSources, type ToolLineContext, type UiToolCall } from "@/lib/ui/tools";
import type { UiMessage } from "@/lib/ui/types";

/** A call as the store records it: the real summarizer, so the mapper is tested against the lines it will actually read. */
function stored(name: string, args: unknown, output: unknown, ok = true): UiToolCall {
  const { args: argsLine, result } = summarizeToolCall({ name, args, output, ok });
  return { name, args: argsLine, result };
}

const people: Record<string, string> = { aaron: "Aaron", lisa: "Michelle" };
const context: ToolLineContext = { to: "Michelle's Muse", owner: "Aaron", person: (id) => people[id] ?? "Michelle" };
const say = (call: UiToolCall) => toolLine(call, context);
const blocks = (count: number) => Array.from({ length: count }, (_, index) => ({ id: index }));
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

describe("the plain-words line for each tool", () => {
  it("says the reel was read and whose it was", () => {
    expect(say(stored("read_signal", {}, { from: "Mochi" }))).toBe("Read the reel from Mochi");
    expect(say(stored("read_signal", {}, {}))).toBe("Read the reel");
  });

  it("says which place was saved", () => {
    expect(say(stored("record_reel_details", { place: "Shawarma Point", area: "E 6th St" }, {}))).toBe("Saved the place: Shawarma Point, E 6th St");
    expect(say(stored("record_reel_details", { place: "Shawarma Point" }, {}))).toBe("Saved the place: Shawarma Point");
    expect(say(stored("record_reel_details", {}, {}))).toBe("Saved the place from the reel");
  });

  it("reads the calendar check as dates and the stored counts, never the events", () => {
    const call = stored("get_my_calendar", { start: "2026-10-25T00:00:00-05:00", end: "2026-10-31T23:59:00-05:00" }, { free: blocks(13), busy: blocks(14) });
    expect(call.args).toBe("2026-10-25 to 2026-10-31");
    expect(say(call)).toBe("Checked the calendar for Oct 25 to Oct 31: 13 free blocks, 14 busy");
    expect(say(stored("get_my_calendar", { start: "2026-10-25", end: "2026-10-25" }, { free: blocks(1), busy: [] }))).toBe("Checked the calendar for Oct 25: 1 free block, 0 busy");
    expect(say(stored("get_my_calendar", {}, { free: [], busy: [] }))).toBe("Checked the calendar: 0 free blocks, 0 busy");
  });

  it("names the interests that were looked at and how many came back", () => {
    expect(say(stored("get_interests", {}, { food: ["ramen", "tacos"], events: ["live music"] }))).toBe("Checked interests: 3 found");
    expect(say(stored("get_interests", { category: "food" }, { food: ["ramen"] }))).toBe("Checked food interests: 1 found");
    expect(say(stored("get_interests", { category: "availability" }, { availability: [] }))).toBe("Checked times interests: none found");
  });

  it("says what was sent, to whom, and what was shared", () => {
    const intent = stored("send_to_friend_agent", { type: "intent", windows: blocks(3), share: ["location"] }, { seq: 1, state: "working" });
    expect(say(intent)).toBe("Sent an invite to Michelle's Muse: 3 times, sharing location");
    expect(say(stored("send_to_friend_agent", { type: "counter", windows: blocks(1) }, { seq: 2, state: "working" }))).toBe("Sent a counter to Michelle's Muse: 1 time");
    expect(say(stored("send_to_friend_agent", { type: "accept" }, { seq: 3, state: "completed" }))).toBe("Sent an acceptance to Michelle's Muse");
    expect(say(stored("send_to_friend_agent", { type: "propose", share: ["availability", "food"] }, { seq: 4, state: "working" }))).toBe("Sent a proposal to Michelle's Muse: sharing times and food");
  });

  it("says a wallet was checked and a receipt was read, without any amount", () => {
    expect(say(stored("get_wallet", {}, { balance: 500 }))).toBe("Checked the wallet");
    expect(say(stored("read_receipt", {}, { total: 48 }))).toBe("Read the receipt for this plan's place");
    expect(say(stored("read_receipt", { receipt: "Shawarma Point" }, { total: 48 }))).toBe("Read the receipt for Shawarma Point");
  });

  it("says a payment was prepared, waiting for its person, and that a sent one was sent", () => {
    const proposal = stored("send_money", { amount: 24, to: "lisa", breakdown: blocks(3) }, { proposed: true, amount: 24 });
    expect(say(proposal)).toBe("Prepared $24 for Michelle, 3 lines, waiting for Aaron to confirm");
    expect(say(stored("send_money", { amount: 24, to: "lisa" }, { proposed: true, amount: 24 }))).toBe("Prepared $24 for Michelle, waiting for Aaron to confirm");
    expect(say(stored("send_money", { amount: 24, to: "lisa", breakdown: blocks(2) }, { amount: 24 }))).toBe("Sent $24 to Michelle, 2 lines");
  });

  it("says a payment was accepted or sent back", () => {
    expect(say(stored("accept_payment", { paymentId: "pay_1" }, { amount: 24 }))).toBe("Accepted the payment and deposited $24");
    expect(say(stored("accept_payment", { paymentId: "pay_1" }, {}))).toBe("Accepted the payment");
    expect(say(stored("decline_payment", { paymentId: "pay_1" }, { amount: 24 }))).toBe("Sent the payment back, refunded $24");
  });

  it("covers the read tools of the chat too", () => {
    expect(say(stored("get_plan", {}, { state: "awaiting_humans" }))).toBe("Read the plan");
    expect(say(stored("get_plan", {}, { none: true }))).toBe("Looked for a plan, none yet");
    expect(say(stored("get_reel", {}, { from: "Mochi" }))).toBe("Read the reel from Mochi");
    expect(say(stored("get_sharing", {}, {}))).toBe("Read the sharing settings");
    expect(say(stored("get_wallet_and_history", {}, { payments: blocks(2) }))).toBe("Checked the wallet and 2 payments");
    expect(say(stored("get_wallet_and_history", {}, { paymentsEnabled: false }))).toBe("Checked the wallet, payments are off");
    expect(say(stored("explain_payment", { paymentId: "pay_1" }, { lines: blocks(3) }))).toBe("Explained a payment, 3 lines");
    expect(say(stored("where_to_do_that", { action: "settle_up" }, {}))).toBe("Pointed to the card: settle up");
  });

  it("says what a web search looked for and how much it found", () => {
    expect(say({ name: "web_search", args: "best shawarma in Austin", result: "4 results" })).toBe('Searched the web for "best shawarma in Austin": 4 results');
    expect(say({ name: "web_search", args: "best shawarma in Austin", result: "0 results" })).toBe('Searched the web for "best shawarma in Austin": no results');
    expect(say({ name: "web_search", args: "", result: "1 result" })).toBe("Searched the web: 1 result");
  });

  it("says what failed, and why, in place of the success line", () => {
    const failed = stored("send_to_friend_agent", { type: "intent" }, { error: "blocked by policy" }, false);
    expect(failed.result).toBe("error: blocked by policy");
    expect(say(failed)).toBe("Could not send the message to Michelle's Muse: blocked by policy");
    expect(say(stored("get_my_calendar", {}, { error: "calendar offline" }, false))).toBe("Could not check the calendar: calendar offline");
  });

  it("falls back to the raw name and arguments for a tool it does not know", () => {
    expect(say({ name: "book_table", args: "Shawarma Point, 2 people", result: "ok" })).toBe("book_table: Shawarma Point, 2 people");
    expect(say({ name: "book_table", args: "", result: "ok" })).toBe("book_table");
    expect(say({ name: "book_table", args: "x", result: "error: sold out" })).toBe("book_table: x, error: sold out");
  });

  it("never uses an em dash", () => {
    const every = [
      stored("read_signal", {}, { from: "Mochi" }),
      stored("get_my_calendar", { start: "2026-10-25", end: "2026-10-31" }, { free: blocks(2), busy: blocks(2) }),
      stored("send_money", { amount: 24, to: "lisa" }, { proposed: true, amount: 24 }),
      stored("send_to_friend_agent", { type: "intent" }, { error: "no" }, false),
    ];
    for (const call of every) expect(say(call)).not.toMatch(new RegExp(String.fromCharCode(0x2014)));
  });
});

describe("the sources a web search carries", () => {
  it("become host chips, up to three, https only, one per host, www dropped", () => {
    const sources = sourcesOf([
      "https://www.eater.com/austin/best-shawarma",
      { url: "https://austin.culturemap.com/news/x", title: "CultureMap" },
      "http://insecure.example.com/page",
      "https://www.eater.com/another-page",
      "javascript:alert(1)",
      "not a url",
      { title: "no url" },
      "https://a.example.org/1",
      "https://b.example.org/2",
    ]);
    expect(sources.map((source) => source.host)).toEqual(["eater.com", "austin.culturemap.com", "a.example.org"]);
    expect(sources[0]?.url).toBe("https://www.eater.com/austin/best-shawarma");
    // The chip's title is the page's own when it came with one, and the host when it did not.
    expect(sources.map((source) => source.title)).toEqual(["eater.com", "CultureMap", "a.example.org"]);
  });

  it("are none when the call has none, or the shape is nonsense", () => {
    expect(sourcesOf(undefined)).toEqual([]);
    expect(sourcesOf("https://eater.com")).toEqual([]);
    expect(sourcesOf([null, 4, {}])).toEqual([]);
  });

  it("ride on a call read from a proof, as sources or as links, and only when there are some", () => {
    const [search, plain] = toolCallsOf({
      toolCalls: [
        { name: "web_search", args: "shawarma", result: "2 results", links: [{ title: "Eater", url: "https://eater.com/a" }] },
        { name: "get_wallet", args: "", result: "balance read" },
      ],
    })!;
    expect(search.sources?.map((source) => source.host)).toEqual(["eater.com"]);
    expect("sources" in plain!).toBe(false);
    const viaSources = toolCallsOf({ toolCalls: [{ name: "web_search", args: "q", result: "1 result", sources: ["https://yelp.com/biz/x"] }] })!;
    expect(viaSources[0]?.sources?.[0]?.host).toBe("yelp.com");
  });
});

describe("the pages a chat answer's search found", () => {
  const pages = [
    { title: "Eater", url: "https://eater.com/a", host: "eater.com" },
    { title: "Yelp", url: "https://yelp.com/b", host: "yelp.com" },
  ];
  const calls: UiToolCall[] = [
    { name: "get_plan", args: "", result: "plan awaiting_humans" },
    { name: "web_search", args: "q", result: "2 results" },
    { name: "web_search", args: "r", result: "1 result" },
  ];

  it("ride on the first web_search call, and on no other", () => {
    const joined = withSearchSources(calls, pages)!;
    expect(joined[1]?.sources).toEqual(pages);
    expect("sources" in joined[0]!).toBe(false);
    expect("sources" in joined[2]!).toBe(false);
  });

  it("leave the calls as they were when there are no pages, or none of the calls is a search", () => {
    expect(withSearchSources(calls, undefined)).toBe(calls);
    expect(withSearchSources(calls, [])).toBe(calls);
    const plain = [calls[0]!];
    expect(withSearchSources(plain, pages)).toEqual(plain);
    expect(withSearchSources(undefined, pages)).toBeUndefined();
  });

  it("keep a search's own pages when it already has some", () => {
    const own = [{ title: "Reddit", url: "https://reddit.com/c", host: "reddit.com" }];
    expect(withSearchSources([{ name: "web_search", args: "q", result: "1 result", sources: own }], pages)![0]?.sources).toEqual(own);
  });
});

describe("the why line on a scheduling message", () => {
  const window = { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" };
  const message = (extra: Partial<UiMessage>) => ({ type: "counter", reason: "both_free", windows: [window], ...extra }) as UiMessage;

  it("says what a counter offered and why", () => {
    expect(whyLine(message({}))).toBe("Countered: offered Tue 6 to 8 PM, free on both calendars");
    expect(whyLine(message({ windows: [window, { start: "2026-10-28T18:00:00-05:00", end: "2026-10-28T20:00:00-05:00" }] }))).toBe("Countered: offered Tue 6 to 8 PM and Wed 6 to 8 PM, free on both calendars");
    expect(whyLine(message({ reason: "interest_match" }))).toBe("Countered: offered Tue 6 to 8 PM");
    expect(whyLine(message({ windows: undefined }))).toBe("Countered: no new time offered");
  });

  it("says why a decline happened", () => {
    expect(whyLine(message({ type: "decline", reason: "no_overlap", windows: undefined }))).toBe("Declined: no time works, no shared free time");
    expect(whyLine(message({ type: "decline", reason: "not_interested", windows: undefined }))).toBe("Declined: not interested");
    expect(whyLine(message({ type: "decline", reason: "cap_reached", windows: undefined }))).toBe("Declined: over the limit");
    expect(whyLine(message({ type: "decline", reason: "settle_up", windows: undefined }))).toBe("Declined");
  });

  it("says what an accept or a proposal settled on", () => {
    expect(whyLine(message({ type: "accept" }))).toBe("Accepted Tue 6 to 8 PM, free on both calendars");
    expect(whyLine(message({ type: "accept", windows: undefined }))).toBe("Accepted");
    expect(whyLine(message({ type: "propose" }))).toBe("Proposed Tue 6 to 8 PM, free on both calendars");
  });

  it("is absent for every other kind of message", () => {
    for (const type of ["intent", "payment", "payment_received", "trip_ask", "trip_plan"] as const) {
      expect(whyLine(message({ type }))).toBeUndefined();
    }
  });
});

describe("toolLines", () => {
  const calls = [stored("read_signal", {}, { from: "Mochi" }), stored("get_wallet", {}, {})];

  it("is one item per call, in order, with the text and no sources unless there are some", () => {
    expect(toolLines(calls, context)).toEqual([
      { text: "Read the reel from Mochi", sources: [] },
      { text: "Checked the wallet", sources: [] },
    ]);
  });

  it("keeps a search's chips on its own line", () => {
    const [line] = toolLines(toolCallsOf({ toolCalls: [{ name: "web_search", args: "q", result: "1 result", sources: ["https://eater.com/a"] }] })!, context);
    expect(line?.sources.map((source) => source.host)).toEqual(["eater.com"]);
  });

  it("shows six lines at most, for the cap the row keeps", () => {
    expect(MAX_TOOL_LINES).toBe(6);
  });
});

describe("the lines under a row", () => {
  const six = Array.from({ length: 6 }, (_, index) => ({ name: "get_wallet", args: "", result: `r${index}` }));
  const render = (extra: object = {}) =>
    renderToStaticMarkup(createElement(ToolLines, { calls: six.slice(0, 2), context, ...extra }));

  it("lists a line per tool in plain words, 12px muted, always visible, with nothing to tap or hover", () => {
    const html = render({ calls: [stored("read_signal", {}, { from: "Mochi" }), stored("get_my_calendar", { start: "2026-10-25", end: "2026-10-31" }, { free: blocks(13), busy: blocks(14) })], why: "Countered: offered Tue 6 to 8 PM" });
    const words = text(html);
    expect(words.indexOf("Read the reel from Mochi")).toBeLessThan(words.indexOf("Checked the calendar for Oct 25 to Oct 31: 13 free blocks, 14 busy"));
    expect(words.indexOf("Checked the calendar")).toBeLessThan(words.indexOf("Countered: offered Tue 6 to 8 PM"));
    expect(html).toContain("text-[12px]");
    expect(html).toContain("text-muted");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("hover:");
    expect(html).not.toContain("title=");
  });

  it("shows up to six lines, then +n more, counting the why line as one", () => {
    const eight = Array.from({ length: 8 }, (_, index) => ({ name: "get_wallet", args: "", result: `r${index}` }));
    const closed = renderToStaticMarkup(createElement(ToolLines, { calls: eight, why: "Declined: no time works", context }));
    expect(closed.match(/data-line/g)).toHaveLength(6);
    expect(text(closed)).toContain("+3 more");
    expect(text(closed)).toContain("Declined: no time works");
    expect(closed).toContain("<button");
    const open = renderToStaticMarkup(createElement(ToolLines, { calls: eight, why: "Declined: no time works", context, initiallyOpen: true }));
    expect(open.match(/data-line/g)).toHaveLength(9);
    expect(text(open)).not.toContain("more");
  });

  it("has no +n more at exactly six lines", () => {
    const html = renderToStaticMarkup(createElement(ToolLines, { calls: six.slice(0, 5), why: "Declined", context }));
    expect(html.match(/data-line/g)).toHaveLength(6);
    expect(text(html)).not.toContain("more");
  });

  it("opens each source in a new tab, as the chat's Source chip, on the search's own line", () => {
    const search = { name: "web_search", args: "shawarma", result: "3 results", sources: [{ title: "Eater", host: "eater.com", url: "https://www.eater.com/a" }, { title: "Yelp", host: "yelp.com", url: "https://yelp.com/b" }, { title: "Reddit", host: "reddit.com", url: "https://reddit.com/c" }] };
    const html = renderToStaticMarkup(createElement(ToolLines, { calls: [search], context }));
    expect(html.match(/<a /g)).toHaveLength(3);
    expect(html).toContain('href="https://www.eater.com/a"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(text(html)).toContain("Source eater.com");
    expect(text(html)).toContain("Source reddit.com");
  });

  it("renders nothing when there is nothing to show", () => {
    expect(renderToStaticMarkup(createElement(ToolLines, { calls: [], context }))).toBe("");
    expect(renderToStaticMarkup(createElement(ToolLines, { calls: undefined, context }))).toBe("");
  });
});

describe("under an agent message row in Activity", () => {
  function row(extra: object | null, tweak?: (message: UiMessage) => void) {
    const state = snapshotAtPlanState("awaiting_humans");
    state.messages[0].proof = { model: "muse-spark-1.3", responseId: "resp_1", latencyMs: 1200, inputTokens: 10, outputTokens: 5, reasoningTokens: 2, ...(extra ?? {}) } as never;
    const snapshot = toUiSnapshot(state, { mode: "live" });
    const message = snapshot.messages[0]!;
    tweak?.(message);
    const html = renderToStaticMarkup(createElement(ActivityRow, { message, initials: discInitials(snapshot), names: namesFor(snapshot), onOpen: () => {} }));
    return { html, message };
  }

  const toolCalls = [
    { name: "read_signal", args: "", result: "reel from Mochi" },
    { name: "get_my_calendar", args: "2026-10-25 to 2026-10-31", result: "13 free blocks, 14 busy" },
    { name: "send_to_friend_agent", args: "intent, 3 windows, share location", result: "message #1 working" },
  ];

  it("shows one plain line per tool the store recorded, after the row's own button", () => {
    const { html } = row({ toolCalls });
    const words = text(html);
    expect(words).toContain("Read the reel from Mochi");
    expect(words).toContain("Checked the calendar for Oct 25 to Oct 31: 13 free blocks, 14 busy");
    expect(words).toMatch(/Sent an invite to .+: 3 times, sharing location/);
    expect(html.indexOf("</button>")).toBeLessThan(html.indexOf("Read the reel from Mochi"));
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it("keeps the privacy line and the proof line as they were", () => {
    const button = (html: string) => html.slice(0, html.indexOf("</button>"));
    const withTools = row({ toolCalls }).html;
    expect(button(withTools)).toBe(button(row(null).html));
    expect(text(withTools)).toContain("muse-spark-1.3");
    expect(text(withTools)).toContain("15 tokens");
  });

  it("shows no lines for a row whose proof recorded no tools", () => {
    const { html, message } = row(null);
    const hasWhy = whyLine(message) !== undefined;
    expect(html).not.toContain("Read the reel");
    expect(html.includes("data-line")).toBe(hasWhy);
  });

  it("adds the why line to a counter or a decline, after the tools", () => {
    const { html } = row({ toolCalls }, (message) => {
      message.type = "decline";
      message.reason = "no_overlap";
      message.windows = undefined;
    });
    const words = text(html);
    expect(words.lastIndexOf("Declined: no time works, no shared free time")).toBeGreaterThan(words.indexOf("Sent an invite"));
  });
});
