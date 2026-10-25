import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { askMembers, driveTrip, capOf, checkItinerary, confirmJoin, declineJoin, fallbackPick, proposeTrip, recordAnswer, startTrip, type TripPlayers } from "@/lib/agent/trip";
import { receiveMessage } from "@/lib/agent/wire";
import { roomLedger } from "@/lib/agent/wallets";
import type { AgentMessage, Plan } from "@/lib/protocol";
import { agentToken } from "@/lib/agent/wire";
import { JsonStore } from "@/lib/store/json";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";

// The trip: Sprout asks each Muse one bounded question, the people answer (here a scripted player stands in for the
// model that plays Michelle and Kai), code makes the cap, Sprout picks from the seeded catalog and code checks it,
// then each person confirms their own deposit into the pot.

let store: JsonStore;
let planId: string;
let clock: number;
const wallNow = () => (clock += 1000);

const compose = (flight: string, stay: string, excursions: string[], rationale = "Pebble gets the Akihabara day and the hotel is step-free; Mochi gets the ramen evening.") => ({
  calls: [{ name: "compose_itinerary", args: { flight, stay, excursions, rationale } }],
});

function players(overrides: Partial<TripPlayers> = {}): TripPlayers {
  return {
    answers: async (member) => (member === "kai" ? { answer: "limit", limit: 1700 } : { answer: "yes" }),
    joins: async () => ({ choice: "in" }),
    ...overrides,
  };
}

beforeEach(async () => {
  store = new JsonStore(null);
  clock = Date.parse("2026-10-25T04:00:00-05:00");
  await store.putRoom({ ...(await store.getRoom()), simulatedFriend: true });
  planId = (await startTrip(store, { wallNow })).planId;
});
afterEach(removeFakeModel);

const planOf = async (): Promise<Plan> => (await store.getPlan(planId))!;
const messagesOf = async (member: "lisa" | "kai") => (await store.listMessages((await planOf()).group!.contexts[member]!)).map((record) => record.message);
const balance = async (accountId: string) => (await roomLedger(store).read())[accountId];

describe("starting a trip", () => {
  it("is a group plan of kind trip with a horizon months out, asking", async () => {
    const plan = await planOf();
    expect(plan).toMatchObject({ kind: "trip", state: "negotiating", group: { coordinator: "aaron", members: ["aaron", "lisa", "kai"] } });
    expect(plan.trip).toMatchObject({ horizon: { label: "July 2027" }, answers: {}, range: { low: 1600, high: 2000 } });
    expect(plan.trip!.horizon.start).toBe("2027-07-10T09:00:00-05:00");
  });
});

describe("a whole trip with one judge alone", () => {
  it("asks, answers, caps, composes, proposes the pot, and confirms once all three are in", async () => {
    // The judge answers Sprout's question for themself: yes.
    expect((await recordAnswer(store, { planId, member: "aaron", answer: "yes", by: "person" }, { wallNow })).ok).toBe(true);
    const model = installFakeModel([compose("FL-1", "ST-1", ["EX-1", "EX-5"])]);
    await driveTrip(store, planId, players(), { wallNow });

    // Each member's thread holds the four messages in order; the answers are the people's.
    for (const member of ["lisa", "kai"] as const) {
      expect((await messagesOf(member)).map((message) => message.type)).toEqual(["trip_ask", "trip_answer", "trip_plan", "trip_reply"]);
    }
    const kaiAnswer = (await messagesOf("kai"))[1];
    expect(kaiAnswer.trip).toMatchObject({ answer: "limit", limit: 1700, taste: "anime", constraint: "low mobility", by: "person_model" });
    expect((await messagesOf("lisa"))[1].trip).toMatchObject({ answer: "yes", limit: 2000, taste: "food, every cuisine" });

    // The cap is the lowest ceiling, with its source.
    const waiting = await planOf();
    expect(waiting.trip!.cap).toEqual({ amount: 1700, basis: "The lowest ceiling: Kai's $1,700, played by a model" });
    expect(waiting.state).toBe("awaiting_humans");

    // The itinerary is the model's pick, checked by code, every line sourced to the seeded catalog.
    expect(waiting.trip!.itinerary).toMatchObject({ total: 1665, composedBy: "model" });
    expect(waiting.trip!.itinerary!.lines.map((line) => line.id)).toEqual(["FL-1", "ST-1", "EX-1", "EX-5"]);
    expect(waiting.trip!.itinerary!.lines.every((line) => line.source.startsWith("Seeded for the demo"))).toBe(true);
    expect(waiting.trip!.unknowns[0]).toMatch(/I do not know/);
    expect(waiting.trip!.unknowns.join(" ")).toMatch(/Film photography/);
    expect(model.calls).toHaveLength(1);
    const prompt = JSON.stringify(model.calls[0]);
    expect(prompt).toContain("low mobility");
    expect(prompt).toContain("Seeded catalog");

    // The pot: 25 percent of 1,665 rounded to the nearest 10, three times, with a sourced breakdown.
    const pot = waiting.trip!.pot!;
    expect(pot).toMatchObject({ perPerson: 420, target: 1260, source: "local" });
    expect(pot.breakdown.every((line) => line.source.length > 0)).toBe(true);

    // The model-played people joined; the judge has not, and no money has left their wallet.
    expect(waiting.group!.decisions).toMatchObject({ lisa: "accepted", kai: "accepted", aaron: "pending" });
    expect(pot.deposits.lisa).toMatchObject({ status: "confirmed", amount: 420 });
    expect(pot.deposits.aaron).toEqual({ amount: 420, status: "proposed" });
    expect(await balance(pot.wallets.aaron!.accountId)).toBe(2500);
    expect(await balance(pot.wallets.lisa!.accountId)).toBe(2080);
    expect(await balance(pot.potAccountId)).toBe(840);
    expect((await messagesOf("kai")).at(-1)!.trip).toMatchObject({ choice: "in", deposit: 420 });

    // The judge confirms their own deposit: money moves, then the yes goes through the lifecycle.
    const joined = await confirmJoin(store, { planId, member: "aaron" }, { wallNow });
    expect(joined.ok && joined.plan.state).toBe("confirmed");
    const done = await planOf();
    expect(await balance(done.trip!.pot!.potAccountId)).toBe(1260);
    expect(await balance(done.trip!.pot!.wallets.aaron!.accountId)).toBe(2080);
    expect(done.trip!.pot!.deposits.aaron).toMatchObject({ status: "confirmed" });
    for (const member of ["lisa", "kai"] as const) expect((await store.getThread((await planOf()).group!.contexts[member]!))?.state).toBe("completed");
  });

  it("a second deposit from the same person finds nothing to do and moves no money twice", async () => {
    await recordAnswer(store, { planId, member: "aaron", answer: "yes", by: "person" }, { wallNow });
    installFakeModel([compose("FL-1", "ST-1", ["EX-1", "EX-5"])]);
    await driveTrip(store, planId, players(), { wallNow });
    expect((await confirmJoin(store, { planId, member: "aaron" }, { wallNow })).ok).toBe(true);
    const again = await confirmJoin(store, { planId, member: "aaron" }, { wallNow });
    expect(again.ok).toBe(false);
    const pot = (await planOf()).trip!.pot!;
    expect(await balance(pot.potAccountId)).toBe(1260);
  });

  it("is dropped for all three when a person passes, and nothing moves for them", async () => {
    await recordAnswer(store, { planId, member: "aaron", answer: "yes", by: "person" }, { wallNow });
    installFakeModel([compose("FL-1", "ST-1", ["EX-1", "EX-5"])]);
    await driveTrip(store, planId, players({ joins: async (member) => ({ choice: member === "kai" ? "out" : "in" }) }), { wallNow });
    const plan = await planOf();
    expect(plan.state).toBe("dropped");
    expect(plan.trip!.pot!.deposits.kai).toMatchObject({ status: "declined" });
    expect(await balance(plan.trip!.pot!.wallets.kai!.accountId)).toBe(2500);
    const kaiMessages = await messagesOf("kai");
    expect(kaiMessages.at(-1)!.trip).toMatchObject({ choice: "out" });
    expect((await store.getThread(plan.group!.contexts.kai!))?.state).toBe("rejected");
  });
});

describe("the numbers are the people's and the seed's", () => {
  it("clamps a model-played person's answer to their seeded ceiling", async () => {
    // A model that says yes for Kai (ceiling $1,700) still records no more than $1,700, and says it was a limit.
    const result = await recordAnswer(store, { planId, member: "kai", answer: "yes", by: "person_model" }, { wallNow });
    expect(result.ok && result.answer).toMatchObject({ answer: "limit", limit: 1700 });
  });

  it("lets a real person's own limit stand, within whole dollars", async () => {
    expect((await recordAnswer(store, { planId, member: "aaron", answer: "limit", limit: 1650, by: "person" }, { wallNow })).ok).toBe(true);
    expect((await planOf()).trip!.answers.aaron).toMatchObject({ answer: "limit", limit: 1650 });
    const bad = await recordAnswer(store, { planId, member: "lisa", answer: "limit", limit: 12, by: "person" }, { wallNow });
    expect(bad.ok).toBe(false);
  });

  it("uses the seeded answer when the model that plays a person does not answer, and says so", async () => {
    await recordAnswer(store, { planId, member: "aaron", answer: "yes", by: "person" }, { wallNow });
    installFakeModel([compose("FL-1", "ST-1", ["EX-1", "EX-5"])]);
    await driveTrip(store, planId, players({ answers: async () => Promise.reject(new Error("model down")) }), { wallNow });
    const plan = await planOf();
    expect(plan.trip!.answers.kai).toMatchObject({ by: "seed", limit: 1700 });
    expect((await messagesOf("kai"))[1].trip?.by).toBe("seed");
  });

  it("refuses an answer message whose number is not the one the person gave", async () => {
    // Kai's person has answered $1,700 (recorded on the plan) but the Muse has not yet said so on the wire.
    await askMembers(store, planId, { wallNow });
    const plan = await planOf();
    await store.putPlan({ ...plan, trip: { ...plan.trip!, answers: { kai: { answer: "limit", limit: 1700, taste: "anime", constraint: "low mobility", by: "person_model", at: "2026-10-25T04:00:00-05:00" } } } });
    const contextId = plan.group!.contexts.kai!;
    const ask = (await messagesOf("kai"))[0];
    const answer = (limit: number, id: string): AgentMessage => ({
      ...ask,
      id,
      from: "kai",
      to: "aaron",
      type: "trip_answer",
      seq: 2,
      state: "working",
      trip: { planId, answer: "limit", limit, taste: "anime", constraint: "low mobility", by: "person_model" },
    });
    const send = (message: AgentMessage) => receiveMessage(store, { recipient: "aaron", sender: "kai", envelope: { message: { ...message, contextId }, stamp: { passed: [], removed: [], windowsDropped: 0 }, redaction: null } });
    const forged = await send(answer(5000, "forged-1"));
    expect(forged).toMatchObject({ ok: false, status: 422, error: expect.stringMatching(/not the one the person gave/) });
    expect((await send(answer(1700, "honest-1"))).ok).toBe(true);
  });

  it("only the member's own bearer can write the member's reply: a forged sender is not Kai", () => {
    expect(agentToken("kai")).not.toBe(agentToken("lisa"));
  });
});

describe("the itinerary", () => {
  const answers = {
    aaron: { answer: "yes", limit: 2000, taste: "ramen and film photography", by: "person", at: "2026-10-25T04:00:00-05:00" },
    lisa: { answer: "yes", limit: 2000, taste: "food, every cuisine", by: "person_model", at: "2026-10-25T04:00:00-05:00" },
    kai: { answer: "limit", limit: 1700, taste: "anime", constraint: "low mobility", by: "person_model", at: "2026-10-25T04:00:00-05:00" },
  } as const;

  it("takes the cap from the lowest ceiling", () => {
    expect(capOf({ ...answers })?.amount).toBe(1700);
  });

  it("refuses a pick over the cap, a pick with stairs for a low-mobility friend, and a pick that leaves a taste out", () => {
    expect(checkItinerary({ flight: "FL-3", stay: "ST-1", excursions: ["EX-1", "EX-5"] }, 1700, { ...answers })).toMatchObject({ ok: false, error: expect.stringMatching(/over the cap/) });
    expect(checkItinerary({ flight: "FL-1", stay: "ST-2", excursions: ["EX-1", "EX-5"] }, 2000, { ...answers })).toMatchObject({ ok: false, error: expect.stringMatching(/low mobility/) });
    // Without a mobility limit in the group, a pick that gives Michelle's taste no line is refused for that.
    const noLimit = { ...answers, kai: { ...answers.kai, constraint: undefined } };
    expect(checkItinerary({ flight: "FL-1", stay: "ST-1", excursions: ["EX-1", "EX-7"] }, 2000, noLimit)).toMatchObject({ ok: false, error: expect.stringMatching(/Michelle/) });
    expect(checkItinerary({ flight: "FL-9", stay: "ST-1", excursions: ["EX-1", "EX-5"] }, 2000, { ...answers })).toMatchObject({ ok: false, error: expect.stringMatching(/not in the seeded catalog/) });
  });

  it("has a code-built pick that fits, so a model outage never leaves the trip without one", () => {
    const pick = fallbackPick(1700, { ...answers });
    expect(pick).not.toBeNull();
    expect(checkItinerary(pick!, 1700, { ...answers }).ok).toBe(true);
    expect(fallbackPick(900, { ...answers })).toBeNull();
  });

  it("repairs a model pick that was over the cap: the first call is refused, the second stands", async () => {
    await recordAnswer(store, { planId, member: "aaron", answer: "yes", by: "person" }, { wallNow });
    const model = installFakeModel([compose("FL-3", "ST-1", ["EX-1", "EX-5"]), compose("FL-1", "ST-1", ["EX-1", "EX-5"])]);
    await driveTrip(store, planId, players(), { wallNow });
    expect(model.calls).toHaveLength(2);
    expect((await planOf()).trip!.itinerary).toMatchObject({ composedBy: "model", total: 1665 });
  });

  it("builds the itinerary by code, labeled, when the model does not answer", async () => {
    await recordAnswer(store, { planId, member: "aaron", answer: "yes", by: "person" }, { wallNow });
    installFakeModel([{ text: "sure" }, { text: "sure" }, { text: "sure" }, { error: 500 }]);
    await driveTrip(store, planId, players(), { wallNow });
    const plan = await planOf();
    expect(plan.trip!.itinerary!.composedBy).toBe("fallback");
    expect(plan.trip!.itinerary!.rationale).toMatch(/Built by code/);
    expect(plan.state).toBe("awaiting_humans");
  });

  it("drops the trip, saying so, when nothing in the seeded catalog fits the cap", async () => {
    await recordAnswer(store, { planId, member: "aaron", answer: "limit", limit: 900, by: "person" }, { wallNow });
    installFakeModel([{ text: "none" }, { text: "none" }, { text: "none" }]);
    await driveTrip(store, planId, players(), { wallNow });
    const plan = await planOf();
    expect(plan.state).toBe("dropped");
    expect(plan.trip!.unknowns.join(" ")).toMatch(/Nothing in the seeded catalog/);
  });
});

describe("without a model-played room", () => {
  it("waits for the people: nothing is answered until a person taps", async () => {
    await store.putRoom({ ...(await store.getRoom()), simulatedFriend: false });
    await driveTrip(store, planId, players(), { wallNow });
    expect((await planOf()).trip!.answers).toEqual({});
    // The questions are out, on both threads.
    expect((await messagesOf("kai")).map((message) => message.type)).toEqual(["trip_ask"]);
    expect((await messagesOf("lisa")).map((message) => message.type)).toEqual(["trip_ask"]);
    // A person answers for Kai from the coordinator's phone, and the trip still waits for the rest.
    expect((await recordAnswer(store, { planId, member: "kai", answer: "limit", limit: 1700, by: "person" }, { wallNow })).ok).toBe(true);
    expect((await planOf()).state).toBe("negotiating");
    expect((await proposeTrip(store, planId, { wallNow })).ok).toBe(false);
  });
});

describe("declining on the trip", () => {
  it("refuses a deposit before the trip is proposed", async () => {
    expect((await confirmJoin(store, { planId, member: "aaron" }, { wallNow })).ok).toBe(false);
    expect((await declineJoin(store, { planId, member: "aaron" }, { wallNow })).ok).toBe(false);
  });
});
