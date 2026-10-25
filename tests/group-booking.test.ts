import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { confirmJoin, driveTrip, recordAnswer, startTrip, type TripPlayers } from "@/lib/agent/trip";
import { answerHotel, bookSeat, flightChoices, holdDates, startBooking, stayMisfit, stayRanking } from "@/lib/agent/trip-booking";
import { roomLedger } from "@/lib/agent/wallets";
import type { MemberId, Plan } from "@/lib/protocol";
import { JsonStore } from "@/lib/store/json";
import { installFakeModel, removeFakeModel } from "./helpers/fakeModel";

// Booking the trip with each person's yes: nothing that costs money moves before the person it is for confirms; what costs
// nothing happens on its own; a double tap books once; a no on the hotel books nothing and brings the next option; Pebble
// refuses a stay that breaks Kai's limit; and the totals equal the ledger.

let store: JsonStore;
let planId: string;
let clock: number;
const wallNow = () => (clock += 1000);
const fast = { wallNow, pauseMs: 0 };
const compose = { calls: [{ name: "compose_itinerary", args: { flight: "FL-1", stay: "ST-1", excursions: ["EX-1", "EX-5"], rationale: "Kai gets the Akihabara day and a step-free hotel; Michelle and Sprout's person get the ramen evening." } }] };

function players(overrides: Partial<TripPlayers> = {}): TripPlayers {
  return {
    answers: async (member) => (member === "kai" ? { answer: "limit", limit: 900 } : { answer: "yes" }),
    joins: async () => ({ choice: "in" }),
    seats: async () => ({ flight: "FL-1" }),
    hotel: async () => ({ choice: "yes" }),
    ...overrides,
  };
}

const planOf = async (): Promise<Plan> => (await store.getPlan(planId))!;
const ledger = async () => roomLedger(store).read();
const balance = async (accountId: string) => (await ledger())[accountId];
const sum = async (accounts: string[]) => (await Promise.all(accounts.map(balance))).reduce((total, value) => total + value, 0);

// A confirmed trip: all three in, the pot at $1,260, nothing booked yet.
async function confirmedTrip() {
  await store.putRoom({ ...(await store.getRoom()), simulatedFriend: true });
  planId = (await startTrip(store, { wallNow })).planId;
  await recordAnswer(store, { planId, member: "aaron", answer: "yes", by: "person" }, { wallNow });
  installFakeModel([compose]);
  await driveTrip(store, planId, players(), fast);
  await confirmJoin(store, { planId, member: "aaron" }, { wallNow });
  expect((await planOf()).state).toBe("confirmed");
  removeFakeModel();
}

async function accounts() {
  const trip = (await planOf()).trip!;
  const wallets = Object.fromEntries(Object.entries(trip.pot!.wallets).map(([member, wallet]) => [member, wallet!.accountId])) as Record<MemberId, string>;
  return { pot: trip.pot!.potAccountId, vendor: trip.booking?.vendorAccountId, wallets };
}

beforeEach(async () => {
  store = new JsonStore(null);
  clock = Date.parse("2026-10-25T10:30:00-05:00");
  await confirmedTrip();
});
afterEach(removeFakeModel);

describe("the booking starts on its own and holds only what is free", () => {
  it("opens a vendor account and holds the dates, with no money moving", async () => {
    const before = await accounts();
    const walletsBefore = await Promise.all(Object.values(before.wallets).map(balance));
    expect((await startBooking(store, planId, fast)).ok).toBe(true);
    expect((await holdDates(store, planId, fast)).ok).toBe(true);
    const plan = await planOf();
    expect(plan.trip!.booking).toMatchObject({ seats: {}, datesHeldAt: expect.any(String) });
    expect(await balance((await accounts()).vendor!)).toBe(0);
    expect(await Promise.all(Object.values(before.wallets).map(balance))).toEqual(walletsBefore);
    // Starting twice changes nothing.
    await startBooking(store, planId, fast);
    expect((await planOf()).trip!.booking!.vendorAccountId).toBe(plan.trip!.booking!.vendorAccountId);
  });

  it("is refused before the trip is confirmed", async () => {
    const fresh = (await startTrip(store, { wallNow })).planId;
    expect((await startBooking(store, fresh, fast)).ok).toBe(false);
  });
});

describe("a flight seat", () => {
  beforeEach(async () => {
    await startBooking(store, planId, fast);
    await holdDates(store, planId, fast);
  });

  it("shows the three seeded flights, each saying whether it fits the cap and the person's own limit", async () => {
    const choices = flightChoices((await planOf()).trip!, "kai");
    expect(choices.map((choice) => [choice.id, choice.cost, choice.withinCap, choice.withinLimit, choice.recommended])).toEqual([
      ["FL-1", 860, true, true, true],
      ["FL-2", 940, false, false, false],
      ["FL-3", 1180, false, false, false],
    ]);
    // Michelle's own limit is $1,000, so the $940 flight is hers to choose, though it is over the group's $900 cap.
    expect(flightChoices((await planOf()).trip!, "lisa").map((choice) => choice.withinLimit)).toEqual([true, true, false]);
  });

  it("takes the price from the person's pot share first, then their own wallet, only on their own confirm", async () => {
    const { pot, wallets } = await accounts();
    const potBefore = await balance(pot);
    expect(potBefore).toBe(1260);
    const booked = await bookSeat(store, { planId, member: "aaron", flightId: "FL-1" }, fast);
    expect(booked.ok).toBe(true);
    // $860 = $420 from the pot and $440 from the wallet ($2,080 after the deposit, $1,640 after the seat).
    expect(await balance(pot)).toBe(1260 - 420);
    expect(await balance(wallets.aaron)).toBe(2080 - 440);
    expect(await balance((await accounts()).vendor!)).toBe(860);
    // Nobody else paid anything: Michelle's and Kai's seats were not booked by this tap.
    expect(await balance(wallets.lisa)).toBe(2080);
    expect(await balance(wallets.kai)).toBe(2080);
    const seat = (await planOf()).trip!.booking!.seats.aaron!;
    expect(seat).toMatchObject({ flightId: "FL-1", amount: 860, fromPot: 420, fromWallet: 440, by: "person" });
    expect(seat.withdrawalIds).toHaveLength(2);
  });

  it("books once when tapped twice, and refuses a flight over the person's own limit", async () => {
    const { pot, wallets } = await accounts();
    expect((await bookSeat(store, { planId, member: "aaron", flightId: "FL-1" }, fast)).ok).toBe(true);
    const again = await bookSeat(store, { planId, member: "aaron", flightId: "FL-1" }, fast);
    expect(again).toMatchObject({ ok: false, status: 409 });
    expect(await balance(pot)).toBe(1260 - 420);
    expect(await balance(wallets.aaron)).toBe(2080 - 440);
    // Kai's limit is $900: the $940 flight is refused and nothing moves.
    const over = await bookSeat(store, { planId, member: "kai", flightId: "FL-2" }, fast);
    expect(over).toMatchObject({ ok: false, status: 422 });
    expect(await balance(wallets.kai)).toBe(2080);
    expect((await planOf()).trip!.booking!.seats.kai).toBeUndefined();
  });

  it("opens the hotel only once all three have a seat", async () => {
    await bookSeat(store, { planId, member: "aaron", flightId: "FL-1" }, fast);
    await bookSeat(store, { planId, member: "lisa", flightId: "FL-2", by: "person_model" }, fast);
    expect((await planOf()).trip!.booking!.hotel).toBeUndefined();
    await bookSeat(store, { planId, member: "kai", flightId: "FL-1", by: "person_model" }, fast);
    expect((await planOf()).trip!.booking!.hotel).toMatchObject({ optionId: "ST-1", state: "proposed", offered: ["ST-1"], approvals: {} });
    // Michelle chose the $940 flight: $420 from the pot, $520 from her wallet.
    expect((await planOf()).trip!.booking!.seats.lisa).toMatchObject({ amount: 940, fromPot: 420, fromWallet: 520, by: "person_model" });
  });
});

describe("the hotel", () => {
  beforeEach(async () => {
    await startBooking(store, planId, fast);
    await holdDates(store, planId, fast);
    for (const member of ["aaron", "lisa", "kai"] as const) await bookSeat(store, { planId, member, flightId: "FL-1", by: member === "aaron" ? "person" : "person_model" }, fast);
  });

  it("books for all three only when all three say yes, from each own wallet, and not before", async () => {
    const { wallets } = await accounts();
    const afterSeats = await Promise.all(Object.values(wallets).map(balance));
    await answerHotel(store, { planId, member: "aaron", choice: "yes" }, fast);
    await answerHotel(store, { planId, member: "lisa", choice: "yes", by: "person_model" }, fast);
    expect(await Promise.all(Object.values(wallets).map(balance))).toEqual(afterSeats);
    expect((await planOf()).trip!.booking!.hotel).toMatchObject({ state: "proposed" });
    const last = await answerHotel(store, { planId, member: "kai", choice: "yes", by: "person_model" }, fast);
    expect(last).toMatchObject({ ok: true, counted: "yes" });
    const hotel = (await planOf()).trip!.booking!.hotel!;
    expect(hotel.state).toBe("booked");
    expect(Object.keys(hotel.booked).sort()).toEqual(["aaron", "kai", "lisa"]);
    expect(await Promise.all(Object.values(wallets).map(balance))).toEqual(afterSeats.map((value) => value - 620));
  });

  it("books nothing on a no, and puts the next-best stay on the table for everyone to answer again", async () => {
    const { wallets } = await accounts();
    const afterSeats = await Promise.all(Object.values(wallets).map(balance));
    await answerHotel(store, { planId, member: "lisa", choice: "yes", by: "person_model" }, fast);
    const no = await answerHotel(store, { planId, member: "aaron", choice: "no" }, fast);
    expect(no).toMatchObject({ ok: true, counted: "no" });
    const hotel = (await planOf()).trip!.booking!.hotel!;
    expect(hotel).toMatchObject({ state: "proposed", optionId: "ST-3", offered: ["ST-1", "ST-3"], approvals: {} });
    expect(hotel.refusals[0]).toMatchObject({ stayId: "ST-1", member: "aaron" });
    expect(await Promise.all(Object.values(wallets).map(balance))).toEqual(afterSeats);
  });

  it("refuses a stay that breaks Kai's limit: Pebble's no is counted even if a yes is sent, and nothing books without Kai's own yes", async () => {
    await answerHotel(store, { planId, member: "aaron", choice: "no" }, fast); // ST-3 is on the table: stairs and floor beds
    const stay = stayRanking((await planOf()).trip!)[1];
    expect(stay.id).toBe("ST-3");
    expect(stayMisfit((await planOf()).trip!, "kai", stay)).toMatch(/Kai has low mobility/);
    await answerHotel(store, { planId, member: "aaron", choice: "yes" }, fast);
    await answerHotel(store, { planId, member: "lisa", choice: "yes" }, fast);
    const kai = await answerHotel(store, { planId, member: "kai", choice: "yes", by: "person_model" }, fast);
    expect(kai).toMatchObject({ ok: true, counted: "no" });
    const hotel = (await planOf()).trip!.booking!.hotel!;
    expect(hotel.refusals.at(-1)).toMatchObject({ stayId: "ST-3", member: "kai" });
    expect(hotel.refusals.at(-1)!.reason).toMatch(/Pebble refused for Kai/);
    expect(hotel.state).not.toBe("booked");
    expect(Object.keys(hotel.booked)).toEqual([]);
  });

  it("ends with no hotel booked when no stay is left that all three can do", async () => {
    await answerHotel(store, { planId, member: "aaron", choice: "no" }, fast); // ST-3 on the table
    await answerHotel(store, { planId, member: "kai", choice: "yes", by: "person_model" }, fast); // Pebble refuses
    // ST-2 on the table now: Kai cannot do that one either.
    await answerHotel(store, { planId, member: "kai", choice: "yes", by: "person_model" }, fast);
    const hotel = (await planOf()).trip!.booking!.hotel!;
    expect(hotel.state).toBe("none_fit");
    expect(hotel.offered).toEqual(["ST-1", "ST-3", "ST-2"]);
    expect(Object.keys(hotel.booked)).toEqual([]);
  });

  it("takes one answer per person per stay", async () => {
    await answerHotel(store, { planId, member: "aaron", choice: "yes" }, fast);
    expect(await answerHotel(store, { planId, member: "aaron", choice: "no" }, fast)).toMatchObject({ ok: false, status: 409 });
  });
});

describe("the whole booking, driven", () => {
  it("runs the simulated people's seats and answers, holds the days, and ends with totals that equal the ledger", async () => {
    const { pot, wallets } = await accounts();
    const everyone = Object.values(wallets);
    const start = await sum([pot, ...everyone]);
    // The judge's own seat and answer are theirs to give; the model-played people go on their own.
    await driveTrip(store, planId, players(), fast);
    expect((await planOf()).trip!.booking!.seats.aaron).toBeUndefined();
    expect(Object.keys((await planOf()).trip!.booking!.seats).sort()).toEqual(["kai", "lisa"]);
    await bookSeat(store, { planId, member: "aaron", flightId: "FL-1" }, fast);
    await driveTrip(store, planId, players(), fast);
    expect((await planOf()).trip!.booking!.hotel).toMatchObject({ state: "proposed", approvals: { lisa: "yes", kai: "yes" } });
    await answerHotel(store, { planId, member: "aaron", choice: "yes" }, fast);
    await driveTrip(store, planId, players(), fast);

    const booking = (await planOf()).trip!.booking!;
    expect(booking.hotel!.state).toBe("booked");
    expect(booking.daysHeldAt).toBeDefined();
    expect(booking.doneAt).toBeDefined();
    // Per person: $2,500 start, $420 pot, $440 flight remainder, $620 hotel, ending at $1,020.
    expect(await Promise.all(everyone.map(balance))).toEqual([1020, 1020, 1020]);
    expect(await balance(pot)).toBe(0);
    // Nothing was created or destroyed: wallets, pot and vendor still add up to what was seeded, and the vendor holds the prices.
    const vendor = await balance((await accounts()).vendor!);
    expect(vendor).toBe(3 * 860 + 3 * 620);
    expect((await sum([pot, ...everyone])) + vendor).toBe(start);
  });

  it("says which seats a model booked and which the seeded profile did", async () => {
    await driveTrip(store, planId, players({ seats: async (member) => (member === "kai" ? Promise.reject(new Error("model down")) : { flight: "FL-1" }) }), fast);
    const seats = (await planOf()).trip!.booking!.seats;
    expect(seats.lisa!.by).toBe("person_model");
    expect(seats.kai!.by).toBe("seed");
    expect(seats.kai!.flightId).toBe("FL-1");
  });

  it("lets a model-played person refuse the hotel on its own, and never counts a yes that breaks Kai's limit", async () => {
    await driveTrip(store, planId, players(), fast);
    await bookSeat(store, { planId, member: "aaron", flightId: "FL-1" }, fast);
    await driveTrip(store, planId, players({ hotel: async (member) => (member === "lisa" ? { choice: "no" } : { choice: "yes" }) }), fast);
    const hotel = (await planOf()).trip!.booking!.hotel!;
    // Michelle said no to Sprout's pick, so ST-3 came up and Pebble refused it for Kai, and so on until none was left.
    expect(hotel.refusals.some((entry) => entry.member === "lisa" && entry.stayId === "ST-1")).toBe(true);
    expect(hotel.refusals.some((entry) => entry.member === "kai" && /Pebble refused for Kai/.test(entry.reason))).toBe(true);
    expect(Object.keys(hotel.booked)).toEqual([]);
  });
});
