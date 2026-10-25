import { flightChoices, stayMisfit, stayRanking } from "@/lib/agent/trip-booking";
import type { MemberId, TripState } from "@/lib/protocol";
import { catalogItem, TRIP, TRIP_PEOPLE, type CatalogItem } from "@/lib/seed/trip";
import type { UiBooking } from "./group";

/*
 * Server-side: turns the booking on a trip into what the cards render, with the wallet balances and the vendor's total read
 * from the ledger (never added up by hand), and the stay's reasons built from the seeded catalog and the people's own limits.
 */

const MEMBERS: MemberId[] = ["aaron", "lisa", "kai"];

/** Why a stay ranks where it does, said plainly from the catalog's own fields. */
function reasonFor(stay: CatalogItem, first: CatalogItem | undefined, trip: TripState): string {
  const parts: string[] = [];
  if (first?.city && stay.city && stay.city !== first.city) parts.push(`in ${stay.city}, not ${first.city} where the flight lands`);
  else if (stay.city) parts.push(`in ${stay.city}`);
  if (stay.effort !== "low") parts.push("asks for stairs or walking");
  const breaks = MEMBERS.filter((member) => stayMisfit(trip, member, stay) !== null).map((member) => TRIP_PEOPLE[member].name);
  if (breaks.length > 0) parts.push(`breaks ${breaks.join(" and ")}'s limit`);
  return parts.join(", ") || "fits everyone";
}

export function toUiBooking(trip: TripState, ledger: Record<string, number>): UiBooking | undefined {
  const booking = trip.booking;
  if (!booking) return undefined;
  const balanceOf = (accountId: string | undefined) => (accountId !== undefined && ledger[accountId] !== undefined ? ledger[accountId] : null);
  const ranking = stayRanking(trip);
  const hotel = booking.hotel;
  const table = hotel ? catalogItem(hotel.optionId) : undefined;
  const flights = flightChoices(trip, "aaron").map((choice) => ({
    id: choice.id,
    label: choice.label,
    cost: choice.cost,
    withinCap: choice.withinCap,
    recommended: choice.recommended,
    withinLimit: Object.fromEntries(MEMBERS.map((member) => [member, flightChoices(trip, member).find((entry) => entry.id === choice.id)?.withinLimit ?? false])) as Partial<Record<MemberId, boolean>>,
  }));
  return {
    datesHeld: booking.datesHeldAt !== undefined,
    flights,
    seats: MEMBERS.flatMap((member) => {
      const seat = booking.seats[member];
      const flight = seat ? catalogItem(seat.flightId) : undefined;
      return seat && flight ? [{ member, flightId: seat.flightId, label: flight.label, amount: seat.amount, fromPot: seat.fromPot, fromWallet: seat.fromWallet, by: seat.by }] : [];
    }),
    hotel:
      hotel && table
        ? {
            option: { id: table.id, label: table.label, cost: table.cost },
            why: table.id === ranking[0]?.id ? `The outline's stay: ${reasonFor(table, ranking[0], trip)}.` : `The next best: ${reasonFor(table, ranking[0], trip)}.`,
            misfits: Object.fromEntries(MEMBERS.flatMap((member) => {
              const misfit = stayMisfit(trip, member, table);
              return misfit ? [[member, misfit]] : [];
            })) as Partial<Record<MemberId, string>>,
            approvals: MEMBERS.flatMap((member) => (hotel.approvals[member] ? [{ member, answer: hotel.approvals[member]!, by: hotel.by?.[member] ?? null }] : [])),
            refusals: hotel.refusals.map((entry) => ({ stayId: entry.stayId, stayLabel: catalogItem(entry.stayId)?.label ?? entry.stayId, member: entry.member, reason: entry.reason })),
            lower: ranking
              .filter((stay) => !hotel.offered.includes(stay.id))
              .map((stay) => ({ id: stay.id, label: stay.label, cost: stay.cost, reason: reasonFor(stay, ranking[0], trip) })),
            booked: MEMBERS.flatMap((member) => (hotel.booked[member] ? [{ member, amount: hotel.booked[member]!.amount, by: hotel.booked[member]!.by }] : [])),
            state: hotel.state,
          }
        : null,
    daysHeld: booking.daysHeldAt !== undefined,
    days: trip.itinerary?.lines.filter((line) => line.kind === "excursion").map((line) => ({ id: line.id, label: line.label })) ?? [],
    done: booking.doneAt !== undefined,
    wallets: MEMBERS.map((member) => ({ member, balance: balanceOf(trip.pot?.wallets[member]?.accountId) })),
    walletStart: TRIP.walletStart,
    vendor: balanceOf(booking.vendorAccountId),
  };
}
