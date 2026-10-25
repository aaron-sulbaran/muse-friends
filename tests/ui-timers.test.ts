import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActivityNote } from "@/components/ActivityNote";
import { ActivityRow } from "@/components/ActivityRow";
import { SettleCard } from "@/components/SettleCard";
import { ToolLines } from "@/components/ToolLines";
import { WorkingRow } from "@/components/WorkingRow";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { discInitials, formatDuration, formatElapsed, namesFor } from "@/lib/ui/format";
import { paymentNoteExtras, toUiSnapshot } from "@/lib/ui/snapshot";
import { inFlightSince } from "@/lib/ui/timers";
import { noteLineContext, toolCallsOf, toolLines, type ToolLineContext } from "@/lib/ui/tools";
import type { UiNote, UiPayment, UiSnapshot } from "@/lib/ui/types";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();

describe("the counter formatting", () => {
  it("counts a running call in whole seconds", () => {
    expect(formatElapsed(0)).toBe("0 s");
    expect(formatElapsed(7)).toBe("7 s");
    expect(formatElapsed(7.9)).toBe("7 s");
    expect(formatElapsed(59.99)).toBe("59 s");
  });

  it("goes to minutes past a minute", () => {
    expect(formatElapsed(60)).toBe("1 min 0 s");
    expect(formatElapsed(125)).toBe("2 min 5 s");
  });

  it("never counts backwards or shows nonsense", () => {
    expect(formatElapsed(-3)).toBe("0 s");
    expect(formatElapsed(Number.NaN)).toBe("0 s");
  });

  it("says how long a finished call took, to a tenth of a second", () => {
    expect(formatDuration(4800)).toBe("4.8 s");
    expect(formatDuration(400)).toBe("0.4 s");
    expect(formatDuration(0)).toBe("0.0 s");
    expect(formatDuration(12345)).toBe("12.3 s");
    expect(formatDuration(125000)).toBe("2 min 5 s");
  });

  it("has no em dash", () => {
    for (const line of [formatElapsed(7), formatDuration(4800)]) expect(line).not.toMatch(new RegExp(String.fromCharCode(0x2014)));
  });
});

describe("when a running call started", () => {
  it("is the since the snapshot carries, when it is a time a moment ago", () => {
    const now = Date.parse("2026-10-25T10:30:10-05:00");
    expect(inFlightSince({ agent: "aaron", agents: ["aaron"], since: "2026-10-25T10:30:03-05:00" }, now)).toBe(Date.parse("2026-10-25T10:30:03-05:00"));
  });

  it("is nothing when there is no since, it is not a time, or it is in the future or long ago", () => {
    const now = Date.parse("2026-10-25T10:30:10-05:00");
    expect(inFlightSince({ agent: "aaron", agents: ["aaron"] }, now)).toBeUndefined();
    expect(inFlightSince({ agent: "aaron", agents: ["aaron"], since: "soon" }, now)).toBeUndefined();
    expect(inFlightSince({ agent: "aaron", agents: ["aaron"], since: "2026-10-25T10:31:10-05:00" }, now)).toBeUndefined();
    expect(inFlightSince({ agent: "aaron", agents: ["aaron"], since: "2026-10-25T09:00:00-05:00" }, now)).toBeUndefined();
    expect(inFlightSince(null, now)).toBeUndefined();
  });
});

describe("the row for a call that is running", () => {
  const snapshot = toUiSnapshot(snapshotAtPlanState("negotiating"), { mode: "live" });
  const render = (extra: object = {}, current: UiSnapshot = snapshot) =>
    renderToStaticMarkup(createElement(WorkingRow, { snapshot: current, names: namesFor(current), initials: discInitials(current), ...extra }));

  it("says who is working and counts up in seconds", () => {
    expect(snapshot.inFlight).not.toBeNull();
    const who = namesFor(snapshot).muse[snapshot.inFlight!.agent];
    expect(text(render({ initialSeconds: 7 }))).toContain(`${who} is working, 7 s`);
  });

  it("is a status the screen reader can follow, with the Muse's own chip and a soft pulse", () => {
    const html = render({ initialSeconds: 3 });
    expect(html).toContain('role="status"');
    expect(html).toContain("animate-working-pulse");
    expect(html).toContain("<img");
  });

  it("names both Muses when both are running", () => {
    const both = { ...snapshot, inFlight: { agent: "aaron" as const, agents: ["aaron" as const, "lisa" as const] } };
    const names = namesFor(both).muse;
    expect(text(render({ initialSeconds: 2 }, both))).toContain(`${names.aaron} and ${names.lisa} are working, 2 s`);
  });

  it("shows no live count in a replay, which plays back what was recorded", () => {
    const replay = { ...snapshot, mode: "replay" as const };
    const who = namesFor(replay).muse[replay.inFlight!.agent];
    const html = render({ initialSeconds: 7 }, replay);
    expect(text(html)).toContain(`${who} is working`);
    expect(text(html)).not.toMatch(/\d+ s\b/);
  });

  it("is nothing when nobody is running", () => {
    expect(render({}, { ...snapshot, inFlight: null })).toBe("");
  });
});

describe("how long each landed row took", () => {
  function row(latencyMs: number) {
    const state = snapshotAtPlanState("awaiting_humans");
    state.messages[0].proof = { model: "muse-spark-1.3", responseId: "resp_1", latencyMs, inputTokens: 10, outputTokens: 5, reasoningTokens: 2 } as never;
    const current = toUiSnapshot(state, { mode: "live" });
    return renderToStaticMarkup(createElement(ActivityRow, { message: current.messages[0]!, initials: discInitials(current), names: namesFor(current), onOpen: () => {} }));
  }

  it("says took with the time to a tenth of a second, from the proof's latency", () => {
    expect(text(row(4800))).toContain("took 4.8 s");
    expect(text(row(8900))).toContain("took 8.9 s");
  });

  it("keeps the model and the tokens on the faint line after it", () => {
    expect(text(row(4800))).toContain("muse-spark-1.3");
    expect(text(row(4800))).toContain("15 tokens");
  });

  it("says nothing about time for a message that did not take any", () => {
    expect(text(row(0))).not.toContain("took");
  });
});

describe("each tool's own time", () => {
  const context: ToolLineContext = { to: "Michelle's Muse", owner: "Aaron", person: () => "Michelle" };

  it("is read from ms, or from durationMs, as a whole number of milliseconds", () => {
    const calls = toolCallsOf({
      toolCalls: [
        { name: "get_my_calendar", args: "2026-10-25 to 2026-10-31", result: "13 free blocks, 14 busy", ms: 412.6 },
        { name: "get_wallet", args: "", result: "balance read", durationMs: 90 },
        { name: "read_signal", args: "", result: "reel from Mochi", ms: -4 },
        { name: "read_receipt", args: "", result: "seeded receipt read", ms: "fast" },
      ],
    })!;
    expect(calls.map((call) => call.ms)).toEqual([413, 90, undefined, undefined]);
    expect("ms" in calls[2]!).toBe(false);
  });

  it("becomes a time after the line, only when the store recorded one", () => {
    const calls = toolCallsOf({ toolCalls: [{ name: "get_my_calendar", args: "2026-10-25 to 2026-10-31", result: "13 free blocks, 14 busy", ms: 400 }, { name: "get_wallet", args: "", result: "balance read" }] })!;
    expect(toolLines(calls, context).map((line) => line.time)).toEqual(["0.4 s", undefined]);
    const words = renderToStaticMarkup(createElement(ToolLines, { calls, context })).replace(/<[^>]+>/g, "");
    expect(words).toContain("Checked the calendar for Oct 25 to Oct 31: 13 free blocks, 14 busy, 0.4 s");
    expect(words).toContain("Checked the wallet");
    expect(words).not.toContain("Checked the wallet,");
  });
});

describe("the settle-up card while the Muse works", () => {
  const offer = { kind: "ready" as const, cap: 20, place: "Shawarma Point" };
  const props = { planId: "plan_1", role: "a" as const, offer, friendName: "Michelle", friendMuse: "Mochi", museName: "Sprout", paymentCount: 0, readOnly: false, onChanged: () => {}, onOpenSettings: () => {} };
  const render = (extra: object = {}) => renderToStaticMarkup(createElement(SettleCard, { ...props, ...extra }));

  it("shows nothing about waiting before the person asks", () => {
    expect(text(render())).not.toContain("Settling up with");
    expect(render()).not.toContain('role="status"');
  });

  it("counts, with a spinner, who the Muse is settling up with, never a frozen button", () => {
    const html = render({ initiallyWorking: true });
    expect(text(html)).toContain("Settling up with Mochi, 0 s");
    expect(html).toContain('role="status"');
    expect(html).toContain("animate-spin");
    expect(html).toContain('disabled=""');
  });

  it("says so when a minute passed and no payment came back, and lets the person ask again", () => {
    const html = render({ initiallyStalled: true });
    expect(text(html)).toContain("No payment came back. Try Settle up again.");
    expect(text(html)).not.toContain("Settling up with");
    expect(html).not.toContain('disabled=""');
  });
});

describe("the tool lines under a payment's rows", () => {
  const calls = [
    { name: "read_receipt", args: "this plan's place", result: "seeded receipt read", ms: 300 },
    { name: "send_money", args: "$15.20 to lisa, 3 lines", result: "prepared $15.20, waiting for your person", ms: 1200 },
  ];
  const payment = (over: Partial<UiPayment> = {}): UiPayment => ({
    id: "pay_1",
    planId: "plan_1",
    from: "aaron",
    to: "lisa",
    amount: 15.2,
    reason: "Your half of the dinner",
    status: "proposed",
    source: "nessie",
    toolCalls: calls,
    at: "2026-10-27T20:00:00-05:00",
    ...over,
  });
  const names = namesFor({ sides: { aaron: "Sprout", lisa: "Mochi", kai: "Pebble" }, humans: { aaron: "Aaron", lisa: "Michelle" } });
  const proposed: UiNote = { id: "n1", kind: "payment_proposed", at: "2026-10-27T20:00:01-05:00", text: "Sprout prepared a payment", payer: "aaron", toolCalls: calls };

  it("take the calls and the payer from the plan's payment", () => {
    expect(paymentNoteExtras([payment()], "plan_1")).toEqual({ payer: "aaron", toolCalls: calls });
    expect(paymentNoteExtras([payment({ id: "pay_0", toolCalls: undefined }), payment()], "plan_1").toolCalls).toBe(calls);
  });

  it("take only the payer when the payment recorded no calls, and nothing when there is no payment", () => {
    expect(paymentNoteExtras([payment({ toolCalls: undefined })], "plan_1")).toEqual({ payer: "aaron" });
    expect(paymentNoteExtras([payment()], "plan_other")).toEqual({});
    expect(paymentNoteExtras([payment()], undefined)).toEqual({});
  });

  it("name the people, from the payer's side", () => {
    const context = noteLineContext("aaron", names);
    expect(context.owner).toBe("Aaron");
    expect(context.person("lisa")).toBe("Michelle");
    expect(context.person("friend")).toBe("Michelle");
    expect(noteLineContext("lisa", names).owner).toBe("Michelle");
    expect(noteLineContext(undefined, names).owner).toBe("you");
    expect(noteLineContext("aaron", undefined).person("lisa")).toBe("your friend");
  });

  it("show under the Payment prepared row, each with its own time", () => {
    const html = renderToStaticMarkup(createElement(ActivityNote, { note: proposed, names })).replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
    expect(html).toContain("Payment prepared");
    expect(html).toContain("Read the receipt for this plan's place, 0.3 s");
    expect(html).toContain("Prepared $15.20 for Michelle, 3 lines, waiting for Aaron to confirm, 1.2 s");
  });

  it("show no lines under a payment row that recorded none", () => {
    const html = renderToStaticMarkup(createElement(ActivityNote, { note: { ...proposed, toolCalls: undefined }, names }));
    expect(html).not.toContain("data-line");
  });
});
