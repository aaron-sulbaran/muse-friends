import { describe, expect, it } from "vitest";
import { freeBlocks, intersectWindows, isSubsetOfBlocks, windowHash } from "@/lib/agent/windows";
import {
  AgentMessage,
  PLAN_STATES,
  Persona,
  RecordedRun,
  SharePolicy,
  Signal,
  StateSnapshot,
  THREAD_CAP,
  isCategoryAllowed,
} from "@/lib/protocol";
import {
  CALENDAR_RANGE,
  DEFAULT_POLICIES,
  PERSONAS,
  PRIVATE_STRINGS,
  SHAWARMA_CONTEXT_ID,
  AGENT_TO_ROLE,
  ROLE_TO_AGENT,
  deadReelSignal,
  extractedShawarmaSignal,
  privacyToggleDemo,
  rawShawarmaSignal,
  recordedSnapshot,
  seedSnapshot,
  shawarmaRun,
} from "@/lib/seed/fixtures";
import { snapshotAtPlanState } from "@/lib/seed/states";

describe("personas", () => {
  it("parse, and only seed two fictional people", () => {
    expect(Persona.parse(PERSONAS.aaron).id).toBe("aaron");
    expect(Persona.parse(PERSONAS.lisa).id).toBe("lisa");
    expect(PERSONAS.aaron.provenance.fictional).toBe(true);
  });

  it("map to roles a and b with the Muse characters as display names", () => {
    expect(ROLE_TO_AGENT).toEqual({ a: "aaron", b: "lisa" });
    expect(AGENT_TO_ROLE).toEqual({ aaron: "a", lisa: "b" });
    expect([PERSONAS.aaron.displayName, PERSONAS.lisa.displayName]).toEqual(["Sprout", "Mochi"]);
  });

  it("have free blocks that overlap on Tuesday 6 to 8pm", () => {
    const mutual = intersectWindows(
      freeBlocks(PERSONAS.aaron.calendar, CALENDAR_RANGE),
      freeBlocks(PERSONAS.lisa.calendar, CALENDAR_RANGE),
    );
    expect(mutual).toContainEqual({ start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" });
    expect(mutual.length).toBeGreaterThan(1);
  });

  it("keep private events marked private", () => {
    for (const [id, strings] of Object.entries(PRIVATE_STRINGS)) {
      const titles = PERSONAS[id as "aaron" | "lisa"].calendar.filter((event) => event.private).map((event) => event.title);
      for (const secret of strings) expect(titles.some((title) => title.includes(secret))).toBe(true);
    }
  });
});

describe("policies", () => {
  it("parse and start with everything on for the close friends", () => {
    for (const policy of DEFAULT_POLICIES) {
      expect(SharePolicy.parse(policy).tier).toBe("close");
      expect(isCategoryAllowed(policy, "location")).toBe(true);
    }
  });
});

describe("the seeded reel signal", () => {
  it("is shaped like Instagram Graph API media fields with a provenance block", () => {
    const signal = Signal.parse(rawShawarmaSignal());
    expect(signal.media.media_product_type).toBe("REELS");
    expect(signal.media.caption).toContain("Shawarma Point");
    expect(signal.provenance).toMatchObject({ source: "seeded", shapedLike: "Instagram Graph API media fields", fictional: true });
    expect(signal.extracted).toBeUndefined();
  });

  it("carries extraction from the caption model once read", () => {
    const signal = Signal.parse(extractedShawarmaSignal());
    expect(signal.extracted?.source).toBe("caption_model");
    expect(signal.extracted?.place).toBe("Shawarma Point");
  });

  it("has a dead copy from weeks earlier for the opening beat", () => {
    const dead = Signal.parse(deadReelSignal());
    expect(Date.parse(dead.receivedAt)).toBeLessThan(Date.parse(rawShawarmaSignal().receivedAt) - 14 * 24 * 3600 * 1000);
  });
});

describe("the recorded shawarma run", () => {
  const run = RecordedRun.parse(shawarmaRun());
  const records = run.snapshot.messages;
  const messages = records.map((record) => record.message);

  it("parses as a whole snapshot", () => {
    expect(StateSnapshot.safeParse(recordedSnapshot()).success).toBe(true);
    expect(StateSnapshot.safeParse(seedSnapshot()).success).toBe(true);
  });

  it("is six messages in order, ending in accept from both agents", () => {
    expect(messages).toHaveLength(THREAD_CAP);
    expect(messages.map((message) => message.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(messages.map((message) => message.from)).toEqual(["aaron", "lisa", "aaron", "lisa", "aaron", "lisa"]);
    expect(messages.slice(-2).map((message) => message.type)).toEqual(["accept", "accept"]);
    expect(messages.map((message) => message.state).slice(0, 5)).toEqual(Array(5).fill("working"));
    expect(messages[5].state).toBe("input-required");
    for (const message of messages) expect(message.contextId).toBe(SHAWARMA_CONTEXT_ID);
  });

  it("only ever proposes windows the sender is actually free for", () => {
    for (const message of messages) {
      const free = freeBlocks(PERSONAS[message.from].calendar, CALENDAR_RANGE);
      for (const window of message.windows ?? []) expect(isSubsetOfBlocks(window, free)).toBe(true);
    }
  });

  it("agrees on a window both calendars share", () => {
    const [agreed] = messages[5].windows ?? [];
    const shared = intersectWindows(
      freeBlocks(PERSONAS.aaron.calendar, CALENDAR_RANGE),
      freeBlocks(PERSONAS.lisa.calendar, CALENDAR_RANGE),
    );
    expect(isSubsetOfBlocks(agreed, shared)).toBe(true);
    expect(run.snapshot.plans[0].window).toEqual(agreed);
  });

  it("never delivers a private string", () => {
    const delivered = JSON.stringify(messages);
    for (const secrets of Object.values(PRIVATE_STRINGS)) {
      for (const secret of secrets) expect(delivered).not.toContain(secret);
    }
  });

  it("ends with the plan awaiting both humans and one card each", () => {
    const [plan] = run.snapshot.plans;
    expect(plan.state).toBe("awaiting_humans");
    expect(plan.history.map((entry) => entry.state)).toEqual(["detected", "negotiating", "awaiting_humans"]);
    expect(run.snapshot.cards.map((card) => card.forAgent).sort()).toEqual(["aaron", "lisa"]);
    expect(run.snapshot.threads[0]).toMatchObject({ state: "input-required", messageCount: 6 });
  });

  it("records the windows that were passed over in the ledger", () => {
    const ledger = run.snapshot.rejectedWindows[SHAWARMA_CONTEXT_ID];
    const proposed = messages[1].windows ?? [];
    expect(ledger).toEqual([windowHash(proposed[0]), windowHash(proposed[2])]);
  });

  it("has an ordered timeline with a human event first and a stamp on every message", () => {
    const times = run.snapshot.events.map((event) => Date.parse(event.at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(run.snapshot.events[0]).toMatchObject({ kind: "signal_received", actor: "human" });
    expect(run.snapshot.events.filter((event) => event.kind === "message_sent")).toHaveLength(THREAD_CAP);
    for (const record of records) expect(record.stamp.removed).toEqual([]);
  });
});

describe("the privacy toggle beat", () => {
  const demo = privacyToggleDemo();

  it("turns Lisa's location off and removes it from the replayed propose", () => {
    expect(isCategoryAllowed(demo.policyBefore, "location")).toBe(true);
    expect(isCategoryAllowed(demo.policyAfter, "location")).toBe(false);
    expect(demo.messageBefore.message.activity?.place).toBe("E 6th St");
    expect(demo.messageBefore.message.shared?.location).toEqual(["East Austin"]);
    expect(AgentMessage.safeParse(demo.messageAfter.message).success).toBe(true);
    expect(demo.messageAfter.message.activity?.place).toBeUndefined();
    expect(demo.messageAfter.message.shared?.location).toBeUndefined();
    expect(demo.messageAfter.stamp.removed).toEqual(["location"]);
    expect(demo.messageAfter.stamp.passed).not.toContain("location");
  });

  it("logs a redaction that names the category but never the value", () => {
    expect(demo.redaction.removed).toEqual(["location"]);
    expect(demo.redaction.detail).not.toContain("E 6th St");
    expect(demo.redaction.detail).not.toContain("East Austin");
  });
});

describe("snapshotAtPlanState", () => {
  it("parses for every plan state and lands in that state", () => {
    for (const state of PLAN_STATES) {
      const snapshot = StateSnapshot.parse(snapshotAtPlanState(state));
      expect(snapshot.plans[0].state).toBe(state);
      expect(snapshot.plans[0].history.at(-1)?.state).toBe(state);
    }
  });

  it("keeps each timeline in time order", () => {
    for (const state of PLAN_STATES) {
      const times = snapshotAtPlanState(state).events.map((entry) => Date.parse(entry.at));
      expect([...times].sort((a, b) => a - b)).toEqual(times);
    }
  });

  it("shows messages, cards, and the thread state the phones need", () => {
    expect(snapshotAtPlanState("detected").messages).toHaveLength(0);
    expect(snapshotAtPlanState("negotiating").messages).toHaveLength(3);
    expect(snapshotAtPlanState("negotiating").threads[0].state).toBe("working");
    expect(snapshotAtPlanState("awaiting_humans").cards.map((card) => card.status)).toEqual(["pending", "pending"]);
    expect(snapshotAtPlanState("confirmed").cards.map((card) => card.status)).toEqual(["accepted", "accepted"]);
    expect(snapshotAtPlanState("scheduled").threads[0].state).toBe("completed");
    expect(snapshotAtPlanState("dropped").plans[0]).toMatchObject({ dropReason: "declined" });
  });

  it("counts follow-through only once the plan happened", () => {
    const counted = (state: (typeof PLAN_STATES)[number]) =>
      snapshotAtPlanState(state).events.filter((entry) => entry.kind === "followed_through").length;
    for (const state of ["detected", "negotiating", "awaiting_humans", "confirmed", "scheduled", "reminded", "dropped"] as const) {
      expect(counted(state)).toBe(0);
    }
    expect(counted("happened")).toBe(1);
    expect(counted("followed_up")).toBe(1);
  });

  it("moves the demo clock forward through the lifecycle", () => {
    const clock = (state: (typeof PLAN_STATES)[number]) => Date.parse(snapshotAtPlanState(state).clock.now);
    expect(clock("reminded")).toBeGreaterThan(clock("scheduled"));
    expect(clock("happened")).toBeGreaterThan(clock("reminded"));
    expect(clock("followed_up")).toBeGreaterThan(clock("happened"));
  });
});
