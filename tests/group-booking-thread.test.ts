import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confirmJoin, driveTrip, recordAnswer, startTrip, type TripPlayers } from "@/lib/agent/trip";
import { answerHotel, bookSeat, holdDates, startBooking } from "@/lib/agent/trip-booking";
import { JsonStore } from "@/lib/store/json";
import { viewForRole, type ChatItem } from "@/lib/ui/chat";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import type { UiSnapshot } from "@/lib/ui/types";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";

// The booking as the thread shows it: one decision on screen at a time, the button on the phone whose person it is, the numbers
// from the ledger, and the honesty labels. The recording of the trip (no booking in it) is checked by group-replay.test.ts.

let store: JsonStore;
let planId: string;
let clock: number;
const wallNow = () => (clock += 1000);
const fast = { wallNow, pauseMs: 0 };
const compose = { calls: [{ name: "compose_itinerary", args: { flight: "FL-1", stay: "ST-1", excursions: ["EX-1", "EX-5"], rationale: "Kai gets the Akihabara day and a step-free hotel; Michelle and Sprout's person get the ramen evening." } }] };
const players: TripPlayers = {
  answers: async (member) => (member === "kai" ? { answer: "limit", limit: 900 } : { answer: "yes" }),
  joins: async () => ({ choice: "in" }),
  seats: async () => ({ flight: "FL-1" }),
  hotel: async () => ({ choice: "yes" }),
};

const ui = async (): Promise<UiSnapshot> => toUiSnapshot(await store.snapshot(), { mode: "live" });
const kinds = (items: ChatItem[]) => items.map((item) => item.kind);
const texts = (items: ChatItem[]) => items.flatMap((item) => (item.kind === "group-line" ? [item.line.text] : []));

beforeEach(async () => {
  store = new JsonStore(null);
  clock = Date.parse("2026-10-25T10:40:00-05:00");
  await store.putRoom({ ...(await store.getRoom()), simulatedFriend: true });
  planId = (await startTrip(store, { wallNow })).planId;
  await recordAnswer(store, { planId, member: "aaron", answer: "yes", by: "person" }, { wallNow });
  installFakeModel([compose]);
  await driveTrip(store, planId, players, fast);
  await confirmJoin(store, { planId, member: "aaron" }, { wallNow });
  removeFakeModel();
});
afterEach(removeFakeModel);

describe("the thread before anything is booked", () => {
  it("ends where it always did on a confirmed trip with no booking yet: all three are in, nothing is booked", async () => {
    const view = viewForRole(await ui(), "a");
    expect(texts(view.items).at(-1)).toBe("All three of you are in. $1,260 is in the pot. Nothing is booked.");
    expect(kinds(view.items)).not.toContain("trip-booking");
  });
});

describe("one decision on screen at a time", () => {
  it("holds the dates first, then asks each person for their own seat, the button only on the phone whose person it is", async () => {
    await startBooking(store, planId, fast);
    await holdDates(store, planId, fast);
    const snapshot = await ui();
    const a = viewForRole(snapshot, "a");
    expect(kinds(a.items).filter((kind) => kind === "trip-booking")).toHaveLength(1);
    const flights = a.items.find((item) => item.kind === "trip-flights");
    expect(flights).toMatchObject({ answerable: ["aaron"], viewer: "aaron" });
    expect(kinds(a.items)).not.toContain("trip-hotel");
    expect(texts(a.items).at(-1)).toBe("I found 3 flights. One fits the $900 cap. Each of you books your own seat.");
    expect(a.status).toEqual({ glyph: "waiting-you", text: "waiting for you" });
    // Michelle's phone (a model plays her here) carries no button for anyone.
    const b = viewForRole(snapshot, "b");
    expect(b.items.find((item) => item.kind === "trip-flights")).toMatchObject({ answerable: [] });
    // Nothing costs money yet: the trip wallets still hold what the pot left them.
    expect(snapshot.plan!.trip!.booking!.wallets.map((wallet) => wallet.balance)).toEqual([2080, 2080, 2080]);
  });

  it("says who booked which seat, with the model-played people labeled, and opens the hotel only after all three", async () => {
    await startBooking(store, planId, fast);
    await holdDates(store, planId, fast);
    await bookSeat(store, { planId, member: "lisa", flightId: "FL-1", by: "person_model" }, fast);
    await bookSeat(store, { planId, member: "kai", flightId: "FL-1", by: "person_model" }, fast);
    let view = viewForRole(await ui(), "a");
    expect(kinds(view.items)).not.toContain("trip-hotel");
    expect(texts(view.items)).toContain("Michelle booked a seat on Austin to Tokyo Haneda, one stop, economy, $860: $420 from the pot and $440 from their trip wallet.");
    await bookSeat(store, { planId, member: "aaron", flightId: "FL-1" }, fast);
    view = viewForRole(await ui(), "a");
    expect(kinds(view.items)).toContain("trip-hotel");
    expect(kinds(view.items)).not.toContain("trip-flights");
    expect(texts(view.items)).toContain("Step-free works for Kai.");
    expect(view.items.find((item) => item.kind === "trip-hotel")).toMatchObject({ answerable: ["aaron"] });
  });

  it("shows the next best stay with its reason after a no, and Pebble's refusal in Pebble's own words", async () => {
    await startBooking(store, planId, fast);
    await holdDates(store, planId, fast);
    for (const member of ["aaron", "lisa", "kai"] as const) await bookSeat(store, { planId, member, flightId: "FL-1", by: member === "aaron" ? "person" : "person_model" }, fast);
    await answerHotel(store, { planId, member: "aaron", choice: "no" }, fast);
    await answerHotel(store, { planId, member: "kai", choice: "yes", by: "person_model" }, fast);
    const lines = texts(viewForRole(await ui(), "a").items);
    expect(lines).toContain("Not this one.");
    expect(lines.some((line) => /^Next best: Asakusa inn.*in Tokyo, asks for stairs or walking, breaks Kai's limit\.$/.test(line))).toBe(true);
    expect(lines.some((line) => /^Pebble refused for Kai: Asakusa inn/.test(line))).toBe(true);
    expect(lines.some((line) => /^Next best: Osaka guesthouse.*in Osaka, not Tokyo where the flight lands/.test(line))).toBe(true);
  });
});

describe("the wrap-up", () => {
  it("reads the numbers from the ledger, and says it was simulated, seeded and that nothing real was bought", async () => {
    await driveTrip(store, planId, players, fast);
    await bookSeat(store, { planId, member: "aaron", flightId: "FL-1" }, fast);
    await driveTrip(store, planId, players, fast);
    await answerHotel(store, { planId, member: "aaron", choice: "yes" }, fast);
    await driveTrip(store, planId, players, fast);
    const snapshot = await ui();
    const booking = snapshot.plan!.trip!.booking!;
    expect(booking.done).toBe(true);
    expect(booking.wallets.map((wallet) => wallet.balance)).toEqual([1020, 1020, 1020]);
    expect(booking.vendor).toBe(3 * 860 + 3 * 620);
    const view = viewForRole(snapshot, "a");
    expect(texts(view.items).at(-1)).toBe("Booked: your seat, the hotel, the dates and two days. Simulated booking, seeded prices; nothing real was bought.");
    expect(view.status).toEqual({ glyph: "done", text: "trip booked" });
    expect(view.items.find((item) => item.kind === "trip-booking")).toMatchObject({ viewer: "aaron" });
  });
});
