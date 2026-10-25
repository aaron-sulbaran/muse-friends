import { describe, expect, it } from "vitest";
import { freeBlocks, isSubsetOfBlocks } from "@/lib/agent/windows";
import { AgentMessage, StateSnapshot, THREAD_CAP, categoriesInMessage } from "@/lib/protocol";
import { CALENDAR_RANGE, PERSONAS, PRIVATE_STRINGS } from "@/lib/seed/fixtures";
import { liveRunBundle, livePrivacyBeat, liveShawarmaRun, replayRun } from "@/lib/seed/live";

// The committed recording is a real run (see `pnpm demo:record`). These checks keep it honest and
// playable: it parses, it carries the proof a live run has, and nothing private or secret is in it.

const bundle = liveRunBundle();
const { run } = bundle;
const { snapshot } = run;
const messages = snapshot.messages.map((record) => record.message);

describe("the recorded live run", () => {
  it("is a live recording that parses as a whole snapshot", () => {
    expect(run).toMatchObject({ source: "live", scenario: "shawarma" });
    expect(StateSnapshot.safeParse(snapshot).success).toBe(true);
    expect(replayRun()).toEqual(liveShawarmaRun());
  });

  it("is a real negotiation: two agents, in turn, within the cap, agreeing on Tuesday 6 to 8pm", () => {
    expect(messages.length).toBeGreaterThanOrEqual(3);
    expect(messages.length).toBeLessThanOrEqual(THREAD_CAP);
    messages.forEach((message, index) => {
      expect(message.seq).toBe(index + 1);
      if (index > 0) expect(message.from).not.toBe(messages[index - 1].from);
    });
    expect(messages.at(-1)).toMatchObject({ type: "accept", state: "input-required" });
    expect(messages.at(-1)?.windows).toEqual([{ start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" }]);
  });

  it("shows the model behind every message: model, response id, latency, and tokens", () => {
    for (const record of snapshot.messages) {
      expect(record.proof).toMatchObject({ model: "muse-spark-1.3", responseId: expect.stringMatching(/^resp_/) });
      expect(record.proof!.latencyMs).toBeGreaterThan(0);
      expect(record.proof!.outputTokens).toBeGreaterThan(0);
    }
    expect(bundle.stats.perMessage.map((row) => row.callMs)).toEqual(snapshot.messages.map((record) => record.proof!.latencyMs));
  });

  it("only offers windows the sender is really free for, and every stamp matches its message", () => {
    for (const record of snapshot.messages) {
      const free = freeBlocks(PERSONAS[record.message.from].calendar, CALENDAR_RANGE);
      for (const window of record.message.windows ?? []) expect(isSubsetOfBlocks(window, free)).toBe(true);
      expect(record.stamp.passed).toEqual(categoriesInMessage(record.message));
    }
  });

  it("walked the whole lifecycle: cards, decisions, hold, reminder, one follow-through, follow-up", () => {
    expect(snapshot.plans[0]).toMatchObject({ state: "followed_up", decisions: { aaron: "accepted", lisa: "accepted" } });
    expect(snapshot.plans[0].history.map((entry) => entry.state)).toEqual([
      "detected",
      "negotiating",
      "awaiting_humans",
      "confirmed",
      "scheduled",
      "reminded",
      "happened",
      "followed_up",
    ]);
    expect(snapshot.cards).toHaveLength(2);
    expect(snapshot.events.filter((event) => event.kind === "followed_through")).toHaveLength(1);
    expect(snapshot.events.find((event) => event.kind === "caption_extracted")?.text).toContain("(extracted from caption)");
    const times = snapshot.events.map((event) => Date.parse(event.at));
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("carries no private string and no key", () => {
    const text = JSON.stringify(bundle);
    for (const secret of Object.values(PRIVATE_STRINGS).flat()) expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
    expect(text).not.toMatch(/LLM_[A-Za-z0-9]{8,}/);
    if (process.env.MODEL_API_KEY) expect(text).not.toContain(process.env.MODEL_API_KEY);
  });

  it("keeps calendars out: only what the agents said and the plan, never a persona's events", () => {
    const text = JSON.stringify(bundle);
    for (const persona of Object.values(PERSONAS)) {
      for (const event of persona.calendar) expect(text).not.toContain(event.title);
    }
  });
});

describe("the privacy beat from the same run", () => {
  const beat = livePrivacyBeat();

  it("exists and replays one sent message with its location removed", () => {
    expect(beat).not.toBeNull();
    const { before, after } = beat!;
    expect(after.message.id).toBe(before.message.id);
    expect(after.message.seq).toBe(before.message.seq);
    expect(categoriesInMessage(before.message)).toContain("location");
    expect(categoriesInMessage(after.message)).not.toContain("location");
    expect(AgentMessage.safeParse(after.message).success).toBe(true);
    expect(after.stamp.removed).toContain("location");
    expect(before.stamp.removed).toEqual([]);
  });

  it("flips only location, in the owner's policy toward the friend", () => {
    const { owner, friend, policyBefore, policyAfter } = beat!;
    expect([policyBefore.owner, policyAfter.owner]).toEqual([owner, owner]);
    expect([policyBefore.friend, policyAfter.friend]).toEqual([friend, friend]);
    expect(policyBefore.categories.location).toBe(true);
    expect(policyAfter.categories.location).toBe(false);
  });

  it("logs a redaction that names the category and never the value, with the timeline rows", () => {
    const { before, redaction, events } = beat!;
    expect(redaction).toMatchObject({ messageId: before.message.id, removed: ["location"] });
    const place = before.message.activity?.place;
    if (place) expect(JSON.stringify([redaction, events])).not.toContain(place);
    expect(events[0].kind).toBe("policy_changed");
    expect(events.slice(1).every((event) => event.kind === "redaction")).toBe(true);
    expect(events.some((event) => event.redactionId === redaction.id)).toBe(true);
  });
});

describe("the recording's numbers", () => {
  it("agree with the run", () => {
    const { stats } = bundle;
    expect(stats.perMessage).toHaveLength(messages.length);
    expect(stats.timeToAgreementMs).toBe(stats.perMessage.at(-1)!.arrivalMs);
    stats.perMessage.forEach((row, index) => {
      expect(row.seq).toBe(index + 1);
      if (index > 0) expect(row.arrivalMs).toBeGreaterThan(stats.perMessage[index - 1].arrivalMs);
    });
    expect(stats.chosenAttempt).toBeLessThanOrEqual(stats.attempts);
  });
});
