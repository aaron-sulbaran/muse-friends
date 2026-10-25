import { LocalLedger } from "@/lib/nessie";
import type { ActivityEvent, MemberId, Plan, PlanGroup, TripBooking, TripHotel, TripSeat, TripState } from "@/lib/protocol";
import { CATALOG, catalogItem, TRIP_PEOPLE, type CatalogItem, type SimulatedMember } from "@/lib/seed/trip";
import type { Store } from "@/lib/store";
import { newId } from "./ids";
import { withLock } from "./lock";
import { roomLedger } from "./wallets";
import { toCentralIso } from "./windows";

// Booking the trip after all three are in (Lisa's plan, trip-booking-consent-v1). The rule is the pot's: nothing that costs
// money is booked until the person it is for says yes, and what costs nothing (the dates, the free day activities) happens on
// its own. The order is one decision at a time: dates held, each person's own flight seat, the hotel (it books only when all
// three say yes), the days as free holds, a wrap-up. Every booking is simulated: seeded prices, paper dollars on the demo's
// local ledger, never a real airline or hotel. The state is Plan.trip.booking; the routes are /api/trip/seat and /hotel.

type Options = { wallNow?: () => number; /** The beat between automatic steps, in ms; tests pass 0. */ pauseMs?: number };
type Source = "person" | "person_model" | "seed";
export type BookingResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string; status: 404 | 409 | 422 | 502 };

// The same lock key as the rest of the trip (lib/agent/trip.ts), so a seat, a join and a drive never interleave.
const lockKey = (planId: string) => `trip:${planId}`;
const nowOf = (options: Options) => options.wallNow?.() ?? Date.now();
const sleep = (ms: number) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());
const money = (amount: number) => `$${amount.toLocaleString("en-US")}`;
const DEFAULT_PAUSE_MS = 1_400;

type TripPlan = Plan & { kind: "trip"; trip: TripState; group: PlanGroup };
function tripOf(plan: Plan | null | undefined): TripPlan | null {
  return plan?.kind === "trip" && plan.trip !== undefined && plan.group !== undefined ? (plan as TripPlan) : null;
}

const row = (plan: Plan, at: string, kind: ActivityEvent["kind"], actor: ActivityEvent["actor"], text: string): ActivityEvent => ({
  id: newId("evt"),
  at,
  kind,
  actor,
  contextId: plan.contextId,
  planId: plan.id,
  text: text.slice(0, 240),
});

async function putBooking(store: Store, plan: TripPlan, patch: Partial<TripBooking>, at: string, trip: Partial<TripState> = {}): Promise<TripPlan> {
  const next: TripPlan = { ...plan, trip: { ...plan.trip, ...trip, booking: { ...plan.trip.booking!, ...patch } }, updatedAt: at };
  await store.putPlan(next);
  return next;
}

// ---------------------------------------------------------------------------
// What is on offer, from the seeded catalog and the people's own answers
// ---------------------------------------------------------------------------

export type FlightChoice = { id: string; label: string; cost: number; withinCap: boolean; recommended: boolean; withinLimit: boolean };

/** The seeded flights, cheapest first, each saying whether it fits the group's cap and this person's own limit. */
export function flightChoices(trip: TripState, member: MemberId): FlightChoice[] {
  const cap = trip.cap?.amount ?? 0;
  const limit = trip.answers[member]?.limit ?? 0;
  const recommended = trip.itinerary?.lines.find((line) => line.kind === "flight")?.id;
  return CATALOG.filter((item) => item.kind === "flight")
    .sort((a, b) => a.cost - b.cost)
    .map((item) => ({ id: item.id, label: item.label, cost: item.cost, withinCap: item.cost <= cap, recommended: item.id === recommended, withinLimit: item.cost <= limit }));
}

const EFFORT_RANK = { low: 0, medium: 1, high: 2 } as const;

/**
 * Sprout's order for the hotel: the outline's stay first, then the rest: the ones in the city the flight lands in, then by how
 * little walking they ask for, then by price. Sprout can say why each one ranks where it does.
 */
export function stayRanking(trip: TripState): CatalogItem[] {
  const picked = trip.itinerary?.lines.find((line) => line.kind === "stay")?.id;
  const stays = CATALOG.filter((item) => item.kind === "stay");
  const first = stays.find((item) => item.id === picked);
  const rest = stays
    .filter((item) => item.id !== picked)
    .sort((a, b) => Number(a.city !== first?.city) - Number(b.city !== first?.city) || EFFORT_RANK[a.effort] - EFFORT_RANK[b.effort] || a.cost - b.cost);
  return first ? [first, ...rest] : rest;
}

/** Why a stay breaks this person's limit, or null when it does not. Only a mobility limit counts today: Kai's. */
export function stayMisfit(trip: TripState, member: MemberId, stay: CatalogItem): string | null {
  const constraint = trip.answers[member]?.constraint ?? TRIP_PEOPLE[member].constraint;
  if (constraint && /mobility/i.test(constraint) && stay.effort !== "low") {
    return `${stay.label} asks for stairs or walking, and ${TRIP_PEOPLE[member].name} has ${constraint}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The ledger: a price goes from the person's pot share and wallet to the simulated vendor, whole or not at all
// ---------------------------------------------------------------------------

async function pay(
  ledger: LocalLedger,
  sources: Array<{ accountId: string; amount: number }>,
  vendorAccountId: string,
  description: string,
): Promise<{ ok: true; withdrawalIds: string[] } | { ok: false; error: string }> {
  const taken: Array<{ accountId: string; amount: number }> = [];
  const ids: string[] = [];
  const undo = async () => {
    for (const source of taken) await ledger.deposit(source.accountId, { amount: source.amount, description: "Refund, the booking did not complete" });
  };
  for (const source of sources.filter((entry) => entry.amount > 0)) {
    const withdrawn = await ledger.withdraw(source.accountId, { amount: source.amount, description });
    if (withdrawn.error !== null) {
      await undo();
      return { ok: false, error: withdrawn.error };
    }
    taken.push(source);
    ids.push(withdrawn.data.id);
  }
  const deposited = await ledger.deposit(vendorAccountId, { amount: taken.reduce((sum, source) => sum + source.amount, 0), description });
  if (deposited.error !== null) {
    await undo();
    return { ok: false, error: deposited.error };
  }
  return { ok: true, withdrawalIds: ids };
}

async function syncWalletBalances(store: Store, plan: TripPlan, ledger: LocalLedger): Promise<TripState["pot"]> {
  const pot = plan.trip.pot;
  if (!pot) return pot;
  const wallets = { ...pot.wallets };
  for (const member of plan.group.members) {
    const wallet = wallets[member];
    if (!wallet) continue;
    const account = await ledger.getAccount(wallet.accountId);
    if (account.error === null) wallets[member] = { accountId: wallet.accountId, balance: account.data.balance };
  }
  return { ...pot, wallets };
}

// ---------------------------------------------------------------------------
// Starting: the vendor account, then the dates, which cost nothing and are held on their own
// ---------------------------------------------------------------------------

export async function startBooking(store: Store, planId: string, options: Options = {}): Promise<BookingResult> {
  return withLock(lockKey(planId), async () => {
    const plan = tripOf(await store.getPlan(planId));
    if (!plan) return { ok: false, error: "no such trip", status: 404 } as const;
    if (plan.state !== "confirmed" || !plan.trip.itinerary || !plan.trip.pot) return { ok: false, error: `the trip is ${plan.state}, not ready to book`, status: 409 } as const;
    if (plan.trip.booking) return { ok: true } as const;
    const ledger = new LocalLedger(roomLedger(store));
    const customer = await ledger.createCustomer({ first_name: "Simulated", last_name: "Bookings Demo", address: { street_number: "100", street_name: "Demo Way", city: "Austin", state: "TX", zip: "78701" } });
    if (customer.error !== null) return { ok: false, error: customer.error, status: 502 } as const;
    const vendor = await ledger.createAccount(customer.data.id, { nickname: "Simulated bookings", balance: 0 });
    if (vendor.error !== null) return { ok: false, error: vendor.error, status: 502 } as const;
    const at = toCentralIso(nowOf(options));
    const next: TripPlan = { ...plan, trip: { ...plan.trip, booking: { vendorAccountId: vendor.data.id, seats: {} } }, updatedAt: at };
    await store.putPlan(next);
    await store.appendEvent(row(next, at, "plan_state", "agent", "Sprout started booking the trip: simulated bookings, seeded prices, and nothing that costs money until each person says yes"));
    return { ok: true } as const;
  });
}

export async function holdDates(store: Store, planId: string, options: Options = {}): Promise<BookingResult> {
  return withLock(lockKey(planId), async () => {
    const plan = tripOf(await store.getPlan(planId));
    if (!plan?.trip.booking) return { ok: false, error: "booking has not started", status: 409 } as const;
    if (plan.trip.booking.datesHeldAt) return { ok: true } as const;
    const at = toCentralIso(nowOf(options));
    const next = await putBooking(store, plan, { datesHeldAt: at }, at);
    await store.appendEvent(row(next, at, "plan_state", "agent", `Sprout held ${next.trip.horizon.label} on all three calendars: a hold that costs nothing, and anyone can remove it`));
    return { ok: true } as const;
  });
}

// ---------------------------------------------------------------------------
// The flight: each person books their own seat
// ---------------------------------------------------------------------------

/**
 * One person books their own seat. The price comes first from that person's share of the pot, then from their own trip
 * wallet, and only on their own confirm. A second confirm for the same person books nothing more.
 */
export async function bookSeat(store: Store, input: { planId: string; member: MemberId; flightId: string; by?: Source }, options: Options = {}): Promise<BookingResult<{ plan: Plan }>> {
  return withLock(lockKey(input.planId), async () => {
    const plan = tripOf(await store.getPlan(input.planId));
    if (!plan) return { ok: false, error: "no such trip", status: 404 } as const;
    const booking = plan.trip.booking;
    const pot = plan.trip.pot;
    if (plan.state !== "confirmed" || !booking || !pot) return { ok: false, error: "the trip is not open for booking", status: 409 } as const;
    if (!booking.datesHeldAt) return { ok: false, error: "the dates are not held yet, so flights are not open", status: 409 } as const;
    if (!plan.group.members.includes(input.member)) return { ok: false, error: "that person is not in this trip", status: 422 } as const;
    if (booking.seats[input.member]) return { ok: false, error: "this person already booked their seat", status: 409 } as const;
    const flight = catalogItem(input.flightId);
    if (!flight || flight.kind !== "flight") return { ok: false, error: "that is not a flight in the seeded catalog", status: 422 } as const;
    const limit = plan.trip.answers[input.member]?.limit ?? 0;
    if (flight.cost > limit) return { ok: false, error: `${flight.label} is ${money(flight.cost)}, over this person's own limit of ${money(limit)} for a flight`, status: 422 } as const;
    const wallet = pot.wallets[input.member];
    if (!wallet) return { ok: false, error: "this person has no trip wallet", status: 409 } as const;

    const ledger = new LocalLedger(roomLedger(store));
    const at = toCentralIso(nowOf(options));
    const fromPot = Math.min(pot.perPerson, flight.cost);
    const fromWallet = flight.cost - fromPot;
    const paid = await pay(
      ledger,
      [
        { accountId: pot.potAccountId, amount: fromPot },
        { accountId: wallet.accountId, amount: fromWallet },
      ],
      booking.vendorAccountId,
      `Simulated seat, ${flight.label}`,
    );
    if (!paid.ok) {
      await store.appendEvent(row(plan, at, "payment_failed", "system", `${TRIP_PEOPLE[input.member].name}'s seat did not book: ${paid.error}. Nothing moved.`));
      return { ok: false, error: paid.error, status: 502 } as const;
    }
    const by = input.by ?? "person";
    const seat: TripSeat = { flightId: flight.id, amount: flight.cost, fromPot, fromWallet, withdrawalIds: paid.withdrawalIds, by, at };
    const seats = { ...booking.seats, [input.member]: seat };
    // The hotel opens once all three have a seat: Sprout's pick for the group, on the table for each to answer.
    const everyone = plan.group.members.every((member) => seats[member]);
    const first = everyone ? stayRanking(plan.trip)[0] : undefined;
    const hotel: TripHotel | undefined = first ? { optionId: first.id, offered: [first.id], approvals: {}, refusals: [], booked: {}, state: "proposed" } : booking.hotel;
    const synced = await syncWalletBalances(store, plan, ledger);
    const next = await putBooking(store, plan, { seats, ...(hotel ? { hotel } : {}) }, at, { pot: synced });
    const how = by === "person_model" ? " (played by a model)" : by === "seed" ? " (seeded: the model did not answer)" : "";
    await store.appendEvent(
      row(
        next,
        at,
        "payment_sent",
        by === "person" ? "human" : "agent",
        `${TRIP_PEOPLE[input.member].name} booked their seat${how}: ${flight.label}, ${money(flight.cost)}, ${money(fromPot)} from the pot and ${money(fromWallet)} from their trip wallet (simulated booking, seeded price; withdrawals ${paid.withdrawalIds.join(", ")})`,
      ),
    );
    return { ok: true, plan: next } as const;
  });
}

// ---------------------------------------------------------------------------
// The hotel: it books only when all three say yes, and a no brings the next option
// ---------------------------------------------------------------------------

/**
 * One person answers for the stay on the table. A yes that would break that person's own limit is not counted (Pebble
 * refuses a stay Kai cannot do, and nothing is booked for Kai without Kai's own yes). A no puts the next-best stay on the
 * table for everyone to answer again, or ends the hotel with nothing booked when none is left. The third yes books it for
 * all three, from each person's own trip wallet.
 */
export async function answerHotel(
  store: Store,
  input: { planId: string; member: MemberId; choice: "yes" | "no"; by?: Source },
  options: Options = {},
): Promise<BookingResult<{ plan: Plan; counted: "yes" | "no" }>> {
  return withLock(lockKey(input.planId), async () => {
    const plan = tripOf(await store.getPlan(input.planId));
    if (!plan) return { ok: false, error: "no such trip", status: 404 } as const;
    const booking = plan.trip.booking;
    const hotel = booking?.hotel;
    if (plan.state !== "confirmed" || !booking || !hotel || hotel.state !== "proposed") return { ok: false, error: "there is no stay waiting for an answer", status: 409 } as const;
    if (!plan.group.members.includes(input.member)) return { ok: false, error: "that person is not in this trip", status: 422 } as const;
    if (hotel.approvals[input.member]) return { ok: false, error: "this person already answered for this stay", status: 409 } as const;
    const stay = catalogItem(hotel.optionId)!;
    const name = TRIP_PEOPLE[input.member].name;
    const at = toCentralIso(nowOf(options));
    const by = input.by ?? "person";

    let counted: "yes" | "no" = input.choice;
    let reason = `${name} said no to ${stay.label}`;
    const misfit = stayMisfit(plan.trip, input.member, stay);
    if (counted === "yes" && misfit) {
      counted = "no";
      reason = `${TRIP_PEOPLE[input.member].muse} refused for ${name}: ${misfit}`;
    }

    if (counted === "yes") {
      const approvals = { ...hotel.approvals, [input.member]: "yes" as const };
      const sources = { ...hotel.by, [input.member]: by };
      const all = plan.group.members.every((member) => approvals[member] === "yes");
      if (!all) {
        const next = await putBooking(store, plan, { hotel: { ...hotel, approvals, by: sources } }, at);
        await store.appendEvent(row(next, at, "plan_state", by === "person" ? "human" : "agent", `${name} said yes to ${stay.label}${by === "person_model" ? " (played by a model)" : by === "seed" ? " (seeded)" : ""}; it books when all three say yes`));
        return { ok: true, plan: next, counted } as const;
      }
      // All three said yes: the stay books, from each person's own trip wallet.
      const pot = plan.trip.pot!;
      const ledger = new LocalLedger(roomLedger(store));
      const booked: TripHotel["booked"] = {};
      for (const member of plan.group.members) {
        const wallet = pot.wallets[member];
        const paid = wallet ? await pay(ledger, [{ accountId: wallet.accountId, amount: stay.cost }], booking.vendorAccountId, `Simulated stay, ${stay.label}`) : ({ ok: false, error: "no trip wallet" } as const);
        if (!paid.ok) {
          // Refund whoever was already charged, so the stay books for all three or for none.
          for (const [done, charge] of Object.entries(booked) as Array<[MemberId, NonNullable<TripHotel["booked"][MemberId]>]>) {
            const back = pot.wallets[done];
            if (back) {
              await ledger.withdraw(booking.vendorAccountId, { amount: charge.amount, description: "Refund, the stay did not book for everyone" });
              await ledger.deposit(back.accountId, { amount: charge.amount, description: "Refund, the stay did not book for everyone" });
            }
          }
          await store.appendEvent(row(plan, at, "payment_failed", "system", `The stay did not book: ${TRIP_PEOPLE[member].name}'s wallet could not pay it (${paid.error}). Nothing is booked.`));
          return { ok: false, error: paid.error, status: 502 } as const;
        }
        booked[member] = { amount: stay.cost, withdrawalId: paid.withdrawalIds[0], by: sources[member] ?? "person", at };
      }
      const synced = await syncWalletBalances(store, plan, ledger);
      const next = await putBooking(store, plan, { hotel: { ...hotel, approvals, by: sources, booked, state: "booked" } }, at, { pot: synced });
      await store.appendEvent(row(next, at, "payment_sent", "agent", `All three said yes, so Sprout booked ${stay.label}: ${money(stay.cost)} each from their trip wallets (simulated booking, seeded price)`));
      return { ok: true, plan: next, counted } as const;
    }

    // A no: nothing is booked, and the next-best stay is offered, or the hotel ends with none.
    const refusals = [...hotel.refusals, { stayId: stay.id, member: input.member, reason: reason.slice(0, 160), at }];
    const nextStay = stayRanking(plan.trip).find((candidate) => !hotel.offered.includes(candidate.id));
    const updated: TripHotel = nextStay
      ? { ...hotel, optionId: nextStay.id, offered: [...hotel.offered, nextStay.id], approvals: {}, by: {}, refusals }
      : { ...hotel, approvals: { ...hotel.approvals, [input.member]: "no" }, by: { ...hotel.by, [input.member]: by }, refusals, state: "none_fit" };
    const next = await putBooking(store, plan, { hotel: updated }, at);
    await store.appendEvent(
      row(next, at, "plan_state", by === "person" ? "human" : "agent", nextStay ? `${reason}. Sprout offers the next option, ${nextStay.label}; nothing was booked` : `${reason}. No stay is left that all three can do, so no hotel is booked`),
    );
    return { ok: true, plan: next, counted } as const;
  });
}

// ---------------------------------------------------------------------------
// The days and the wrap-up: free holds, then the numbers from the ledger
// ---------------------------------------------------------------------------

export async function holdDays(store: Store, planId: string, options: Options = {}): Promise<BookingResult> {
  return withLock(lockKey(planId), async () => {
    const plan = tripOf(await store.getPlan(planId));
    const booking = plan?.trip.booking;
    if (!plan || !booking?.hotel || booking.hotel.state === "proposed") return { ok: false, error: "the hotel is not settled yet", status: 409 } as const;
    if (booking.daysHeldAt) return { ok: true } as const;
    const at = toCentralIso(nowOf(options));
    const days = plan.trip.itinerary?.lines.filter((line) => line.kind === "excursion").map((line) => line.label) ?? [];
    const next = await putBooking(store, plan, { daysHeldAt: at }, at);
    await store.appendEvent(row(next, at, "plan_state", "agent", `Sprout reserved the days as free holds, pay on the day: ${days.join("; ") || "no day activities"}`));
    return { ok: true } as const;
  });
}

export async function finishBooking(store: Store, planId: string, options: Options = {}): Promise<BookingResult> {
  return withLock(lockKey(planId), async () => {
    const plan = tripOf(await store.getPlan(planId));
    const booking = plan?.trip.booking;
    if (!plan || !booking?.daysHeldAt) return { ok: false, error: "the days are not held yet", status: 409 } as const;
    if (booking.doneAt) return { ok: true } as const;
    const at = toCentralIso(nowOf(options));
    const next = await putBooking(store, plan, { doneAt: at }, at);
    await store.appendEvent(row(next, at, "plan_state", "system", "The trip is booked: simulated bookings, seeded prices, nothing real was bought"));
    return { ok: true } as const;
  });
}

// ---------------------------------------------------------------------------
// Driving it: the automatic steps, and the people a model plays, one beat apart
// ---------------------------------------------------------------------------

/** What plays the simulated people in the booking: one real model call each, injected so a test can script it. */
export type BookingPlayers = {
  seats: (member: SimulatedMember, summary: string, choices: FlightChoice[]) => Promise<{ flight: string }>;
  hotel: (member: SimulatedMember, summary: string) => Promise<{ choice: "yes" | "no" }>;
};

export function seatSummary(trip: TripState, member: MemberId, choices: FlightChoice[]): string {
  const list = choices.map((choice) => `${choice.id}: ${choice.label}, ${money(choice.cost)}${choice.recommended ? " (Sprout's pick)" : ""}${choice.withinLimit ? "" : ", over your limit"}`).join("; ");
  return `Time to book your own seat for ${trip.title}. Your flight limit is ${money(trip.answers[member]?.limit ?? 0)}. The flights: ${list}. The first ${money(trip.pot?.perPerson ?? 0)} comes from your share of the pot and the rest from your trip wallet. This is a simulated booking with seeded prices.`;
}

export function hotelSummary(trip: TripState, member: MemberId, stay: CatalogItem): string {
  const misfit = stayMisfit(trip, member, stay);
  return `Sprout's pick for the hotel is ${stay.label}, ${money(stay.cost)} each from your trip wallet. It books only when all three of you say yes. ${misfit ? `Note: ${misfit}.` : "It fits what you told Sprout."} This is a simulated booking with seeded prices. Do you say yes?`;
}

/** The seeded fallback for a person whose model did not answer: Sprout's recommended flight if it is within their limit, else the cheapest that is. */
function seededFlight(choices: FlightChoice[]): string {
  return (choices.find((choice) => choice.recommended && choice.withinLimit) ?? choices.find((choice) => choice.withinLimit) ?? choices[0]).id;
}

/**
 * Moves the booking along as far as it can without a person: the dates, the simulated people's seats and answers, then the
 * days and the wrap-up. A person's own tap stops it (the judge's seat, their answer for the hotel) and calls it again.
 * `simulated` is who a model plays in this room. Idempotent.
 */
export async function driveBooking(store: Store, planId: string, players: BookingPlayers, simulated: MemberId[], options: Options = {}): Promise<void> {
  const pause = () => sleep(options.pauseMs ?? DEFAULT_PAUSE_MS);
  for (let step = 0; step < 16; step += 1) {
    const plan = tripOf(await store.getPlan(planId));
    if (!plan || plan.state !== "confirmed") return;
    if (!plan.trip.booking) {
      await pause();
      await startBooking(store, planId, options);
      continue;
    }
    const booking = plan.trip.booking;
    if (!booking.datesHeldAt) {
      await pause();
      await holdDates(store, planId, options);
      continue;
    }
    if (!booking.hotel) {
      const waiting = simulated.filter((member) => !booking.seats[member]);
      if (waiting.length === 0) return; // the people who are really there have to book their own seat
      await pause();
      await Promise.all(
        waiting.map(async (member) => {
          const choices = flightChoices(plan.trip, member);
          let flight = seededFlight(choices);
          let by: Source = "seed";
          try {
            const played = await players.seats(member as SimulatedMember, seatSummary(plan.trip, member, choices), choices);
            if (choices.some((choice) => choice.id === played.flight && choice.withinLimit)) {
              flight = played.flight;
              by = "person_model";
            }
          } catch (error) {
            console.error(`${member} did not choose a seat`, error);
          }
          await bookSeat(store, { planId, member, flightId: flight, by }, options);
        }),
      );
      continue;
    }
    if (booking.hotel.state === "proposed") {
      const stay = catalogItem(booking.hotel.optionId)!;
      const waiting = simulated.filter((member) => !booking.hotel!.approvals[member]);
      if (waiting.length === 0) return; // the people who are really there have to answer for the stay
      await pause();
      await Promise.all(
        waiting.map(async (member) => {
          let choice: "yes" | "no" = stayMisfit(plan.trip, member, stay) ? "no" : "yes";
          let by: Source = "seed";
          try {
            choice = (await players.hotel(member as SimulatedMember, hotelSummary(plan.trip, member, stay))).choice;
            by = "person_model";
          } catch (error) {
            console.error(`${member} did not answer for the stay`, error);
          }
          await answerHotel(store, { planId, member, choice, by }, options);
        }),
      );
      continue;
    }
    if (!booking.daysHeldAt) {
      await pause();
      await holdDays(store, planId, options);
      continue;
    }
    if (!booking.doneAt) {
      await pause();
      await finishBooking(store, planId, options);
      continue;
    }
    return;
  }
}
