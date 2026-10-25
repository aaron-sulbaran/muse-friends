import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confirmJoin, driveTrip, recordAnswer, startTrip, type TripPlayers } from "@/lib/agent/trip";
import { JsonStore } from "@/lib/store/json";
import { viewForRole, type ChatItem } from "@/lib/ui/chat";
import { answerText, cardsOnPhone, tripDates, tripOwners, tripThread, tripWithNames } from "@/lib/ui/group";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import type { Role, UiSnapshot } from "@/lib/ui/types";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";

// The trip's group thread as each phone reads it, from a real engine run on the JSON store.

let store: JsonStore;
let planId: string;
let clock: number;
const wallNow = () => (clock += 1000);
const players: TripPlayers = {
  answers: async (member) => (member === "kai" ? { answer: "limit", limit: 900 } : { answer: "yes" }),
  joins: async () => ({ choice: "in" }),
  seats: async () => ({ flight: "FL-1" }),
  hotel: async () => ({ choice: "yes" }),
};
const compose = { calls: [{ name: "compose_itinerary", args: { flight: "FL-1", stay: "ST-1", excursions: ["EX-1", "EX-5"], rationale: "Kai gets the Akihabara day and a step-free hotel; Michelle and Sprout's person get the ramen evening." } }] };

const ui = async (): Promise<UiSnapshot> => toUiSnapshot(await store.snapshot(), { mode: "live" });
const texts = (items: ChatItem[]) => items.flatMap((item) => (item.kind === "group-line" ? [item.line.text] : []));

beforeEach(async () => {
  store = new JsonStore(null);
  clock = Date.parse("2026-10-25T04:00:00-05:00");
  await store.putRoom({ ...(await store.getRoom()), simulatedFriend: true });
  planId = (await startTrip(store, { wallNow })).planId;
});
afterEach(removeFakeModel);

async function runToTheJudge() {
  await recordAnswer(store, { planId, member: "aaron", answer: "yes", by: "person" }, { wallNow });
  installFakeModel([compose]);
  await driveTrip(store, planId, { ...players, joins: async () => ({ choice: "in" }) }, { wallNow });
}

describe("the thread before the judge answers", () => {
  it("opens with the seeded group chat, Sprout's ask, and the judge's own question last", async () => {
    await driveTrip(store, planId, players, { wallNow });
    const view = viewForRole(await ui(), "a");
    expect(view.items[0]).toMatchObject({ kind: "separator", day: "Group chat, seeded for the demo" });
    expect(texts(view.items).slice(0, 3)).toEqual(["We NEED to do Japan next summer.", "Same. Anime for me, and nothing with a lot of stairs, please.", "Sprout, can you make this happen?"]);
    // The pending question is a card at the end, where the newest thing belongs.
    expect(view.items.at(-1)).toMatchObject({ kind: "trip-question", member: "aaron", forName: null, range: { low: 800, high: 1000 } });
    expect(view.status).toEqual({ glyph: "waiting-you", text: "waiting for you" });
  });

  it("says who each Muse belongs to, and tags the people a model plays", async () => {
    await driveTrip(store, planId, players, { wallNow });
    const view = viewForRole(await ui(), "a");
    const lines = view.items.flatMap((item) => (item.kind === "group-line" ? [item.line] : []));
    const sprout = lines.find((line) => line.sender.name === "Sprout")!;
    expect(sprout.sender).toMatchObject({ kind: "your-muse", agent: "aaron" });
    expect(lines.find((line) => line.sender.name === "Mochi")!.sender).toMatchObject({ kind: "friend-muse", owner: "Michelle", agent: "lisa" });
    expect(lines.find((line) => line.sender.name === "Pebble")!.sender).toMatchObject({ kind: "friend-muse", owner: "Kai", agent: "kai" });
    expect(lines.filter((line) => ["Michelle", "Kai"].includes(line.sender.name)).every((line) => line.sender.simulated)).toBe(true);
    expect(lines.filter((line) => line.sender.kind === "you").every((line) => line.sender.simulated === undefined)).toBe(true);
  });

  it("writes a person's line from the answer they gave, never from a guess", async () => {
    await driveTrip(store, planId, players, { wallNow });
    const snapshot = await ui();
    const lines = texts(viewForRole(snapshot, "a").items);
    expect(lines).toContain("Yes, that works.");
    expect(lines).toContain("My limit is $900.");
    expect(lines).toContain("Michelle's limit for a flight is $1,000. Food, every cuisine.");
    expect(lines).toContain("Kai's limit for a flight is $900. Anime, and low mobility.");
    const trip = snapshot.plan!.trip!;
    expect(answerText(trip, { ...trip.answers[0], answer: "no" })).toBe("Not quite that much. $800 is my limit.");
  });
});

describe("the thread after the proposal", () => {
  it("shows the budget with its sources, the checked outline, what is not known, and the pot", async () => {
    await runToTheJudge();
    const snapshot = await ui();
    const view = viewForRole(snapshot, "a");
    const kinds = view.items.map((item) => item.kind);
    expect(kinds).toEqual(expect.arrayContaining(["trip-budget", "trip-itinerary", "trip-open", "trip-pot"]));
    expect(kinds.indexOf("trip-budget")).toBeLessThan(kinds.indexOf("trip-itinerary"));
    expect(kinds.indexOf("trip-itinerary")).toBeLessThan(kinds.indexOf("trip-open"));
    expect(kinds.indexOf("trip-open")).toBeLessThan(kinds.indexOf("trip-pot"));
    const trip = snapshot.plan!.trip!;
    expect(trip.cap).toMatchObject({ amount: 900 });
    expect(trip.itinerary!.lines.every((line) => line.source.startsWith("Seeded for the demo"))).toBe(true);
    expect(trip.unknowns[0]).toMatch(/do not know/);
    expect(texts(view.items)).toContain("Everyone answered. Flights stay at or under $900 each.");
    expect(texts(view.items).join(" ")).toMatch(/Nothing here is booked/);
    // Nobody has been asked for money without the way to say no, and nobody has paid before confirming.
    const pot = view.items.find((item) => item.kind === "trip-pot");
    expect(pot).toMatchObject({ answerable: ["aaron"], viewer: "aaron", state: "awaiting_humans" });
    expect(trip.pot!.deposits.find((deposit) => deposit.member === "aaron")).toMatchObject({ status: "proposed", amount: 420 });
    expect(view.status).toEqual({ glyph: "waiting-you", text: "waiting for you" });
  });

  it("says each person is in only after they confirmed their deposit, and the plan is confirmed when all three are", async () => {
    await runToTheJudge();
    const before = texts(viewForRole(await ui(), "a").items);
    expect(before).toContain("Michelle is in. $420 in the pot.");
    expect(before).not.toContain("All three of you are in. $1,260 is in the pot. Nothing is booked.");
    await confirmJoin(store, { planId, member: "aaron" }, { wallNow });
    const view = viewForRole(await ui(), "a");
    expect(texts(view.items)).toContain("All three of you are in. $1,260 is in the pot. Nothing is booked.");
    expect(view.status).toEqual({ glyph: "done", text: "all three are in" });
  });

  it("is told from Michelle's side on her phone: her Muse is hers, Sprout belongs to the organizer, and no card asks her", async () => {
    await runToTheJudge();
    const view = viewForRole(await ui(), "b");
    const lines = view.items.flatMap((item) => (item.kind === "group-line" ? [item.line] : []));
    expect(lines.find((line) => line.sender.name === "Mochi")!.sender.kind).toBe("your-muse");
    expect(lines.find((line) => line.sender.name === "Sprout")!.sender).toMatchObject({ kind: "friend-muse", owner: undefined });
    const pot = view.items.find((item) => item.kind === "trip-pot");
    expect(pot).toMatchObject({ answerable: [], viewer: "lisa" });
  });

  it("with a real friend, Michelle's card is on her own phone and Kai has none: a model plays Kai, and the thread says Pebble is asking", async () => {
    await store.putRoom({ ...(await store.getRoom()), simulatedFriend: false });
    await driveTrip(store, planId, players, { wallNow });
    const snapshot = await ui();
    expect(cardsOnPhone(snapshot, "a")).toEqual(["aaron"]);
    expect(cardsOnPhone(snapshot, "b")).toEqual(["lisa"]);
    const onA = viewForRole(snapshot, "a").items.filter((item) => item.kind === "trip-question");
    expect(onA.map((item) => (item.kind === "trip-question" ? item.member : ""))).toEqual(["aaron"]);
    const onB = viewForRole(snapshot, "b").items.filter((item) => item.kind === "trip-question");
    expect(onB).toHaveLength(1);
    // Kai answered through the model, so Pebble relays it and no one is asked for Kai.
    expect(texts(viewForRole(snapshot, "a").items)).toContain("Kai's limit for a flight is $900. Anime, and low mobility.");
  });

  it("calls an unnamed person your friend, never a new word, and puts the reader first in the header line", async () => {
    await runToTheJudge();
    const snapshot = await ui();
    const onB = viewForRole(snapshot, "b");
    const organizer = onB.items.flatMap((item) => (item.kind === "group-line" ? [item.line] : [])).find((line) => line.sender.name === "Your friend");
    expect(organizer?.sender.kind).toBe("friend");
    expect(onB.items.flatMap((item) => (item.kind === "group-line" ? [item.line.sender.name] : []))).not.toContain("The organizer");
    const trip = tripWithNames(snapshot, snapshot.plan!.trip!);
    expect(tripOwners(trip, "lisa")).toBe("You, your friend, and Kai, with Sprout, Mochi, and Pebble");
    expect(tripOwners(trip, "aaron")).toBe("You, Michelle, and Kai, with Sprout, Mochi, and Pebble");
  });
});

describe("the group header words and dates", () => {
  it("names the three people, then their three Muses, and the exact days", async () => {
    const trip = (await ui()).plan!.trip!;
    expect(tripOwners(trip, "aaron")).toBe("You, Michelle, and Kai, with Sprout, Mochi, and Pebble");
    expect(tripDates(trip)).toBe("July 10 to 17, 2027");
  });

  it("is the same thread for both phones, only reoriented", async () => {
    await runToTheJudge();
    const snapshot = await ui();
    for (const role of ["a", "b"] as Role[]) {
      const thread = tripThread(snapshot, role);
      expect(thread.items.filter((item) => item.kind === "trip-itinerary")).toHaveLength(1);
      expect(thread.items.filter((item) => item.kind === "group-line").length).toBeGreaterThan(10);
    }
  });
});
