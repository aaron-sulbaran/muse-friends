"use client";

import { CircleDashed } from "lucide-react";
import { useState } from "react";
import type { ChatItem } from "@/lib/ui/chat";
import { postTripHotel, postTripJoin, postTripSeat } from "@/lib/ui/actions";
import { answerWord, money, personOf, servedBy, tripDates, type GroupLine, type UiBooking } from "@/lib/ui/group";
import type { AvatarMood, MemberId, UiTrip } from "@/lib/ui/types";
import { capital } from "@/lib/ui/tokens";
import { CheckMark } from "./CheckMark";
import { MuseAvatar } from "./MuseAvatar";
import { PersonDisc } from "./PersonDisc";
import { QuestionCard } from "./QuestionCard";
import { ThreadBubble } from "./ThreadBubble";

/*
 * The trip's group thread (D30, D32): people and their Muses in one chat. A Muse's bubble is tinted for that Muse and
 * its chip says whose Muse it is; a person who is played by a model carries a "simulated" tag that explains itself when
 * tapped. The decisions are cards, indented to the bubble column: the bounded question, the budget, the plan, the pot.
 * Every number on a card names its source, and anything seeded says so.
 */

const cardShell = "ml-8 max-w-[92%] animate-card-in rounded-card bg-surface p-5 shadow-float";

/** One line of the thread, drawn by the shared thread bubble (chip above the first, picture beside the last). */
function GroupBubble({ line }: { line: GroupLine }) {
  return <ThreadBubble line={line} showSender={line.first} showPicture={line.last} />;
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] font-semibold leading-[18px] text-muted">{children}</p>;
}

/** Who answered what, and whose Muse carried it. Built only from the answers on the record. */
function BudgetCard({ trip }: { trip: UiTrip }) {
  const cap = trip.cap!;
  const modelPlayed = trip.people.filter((person) => person.simulated && person.member !== "aaron").map((person) => person.name);
  return (
    <section className={cardShell}>
      <CardLabel>Flight budget</CardLabel>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-[40px] font-bold leading-[46px]">{money(cap.amount)}</span>
        <span className="text-[17px] font-semibold text-muted">each, at most</span>
      </p>
      <p className="mt-1 text-[13px] leading-[18px] text-muted">{cap.basis}. Nobody is asked why.</p>
      <ul className="mt-3.5 space-y-2.5">
        {trip.people.map((person) => {
          const answer = trip.answers.find((entry) => entry.member === person.member);
          if (!answer) return null;
          const source =
            person.member === "aaron"
              ? "Your answer"
              : answer.by === "seed"
                ? `${person.muse} asked, seeded answer`
                : `${person.muse} asked ${person.name}`;
          return (
            <li key={person.member} className="flex items-center gap-3">
              <PersonDisc name={person.member === "aaron" ? "You" : person.name} size={28} />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold leading-5">{person.member === "aaron" ? "You" : person.name}</p>
                <p className="text-[12px] leading-4 text-muted">{source}</p>
              </div>
              <span className="text-[15px] font-semibold">{answerWord(answer)}</span>
            </li>
          );
        })}
      </ul>
      {modelPlayed.length > 0 ? <p className="mt-3 text-[12px] leading-4 text-muted">{modelPlayed.join(" and ")} {modelPlayed.length > 1 ? "are" : "is"} played by a model for this demo.</p> : null}
    </section>
  );
}

const kindLabel = { flight: "Flight", stay: "Stay", excursion: "Day trip" } as const;

function ItineraryCard({ trip }: { trip: UiTrip }) {
  const plan = trip.itinerary!;
  const dates = `${tripDates(trip)}, seven nights`;
  return (
    <section className={cardShell}>
      <CardLabel>Plan for the three of you</CardLabel>
      <h3 className="mt-0.5 text-[21px] font-bold leading-[26px]">{trip.title}</h3>
      <dl className="mt-3 divide-y divide-bezel-line">
        <div className="py-2.5">
          <dt className="text-[13px] font-semibold leading-[18px] text-muted">Dates</dt>
          <dd className="text-[15px] font-semibold leading-5">{dates}</dd>
          <dd className="text-[14px] leading-5 text-muted">Months out, so no calendar is checked yet</dd>
        </div>
        {plan.lines.map((line) => {
          const who = servedBy(trip, line.serves);
          return (
            <div key={line.id} className="py-2.5">
              <dt className="flex items-center justify-between gap-2 text-[13px] font-semibold leading-[18px] text-muted">
                {kindLabel[line.kind]}
                <span className="rounded-full bg-group px-1.5 py-px text-[11px] leading-[14px]">{trip.seededLabel}</span>
              </dt>
              <dd className="text-[15px] font-semibold leading-5">
                {line.label}, {money(line.cost)}
              </dd>
              {who.length > 0 ? <dd className="text-[14px] leading-5 text-muted">For {who.join(" and ")}</dd> : null}
              <dd className="text-[12px] leading-4 text-faint">{line.source}</dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-1 text-[15px] font-semibold leading-5">
        {money(plan.total)} per person <span className="font-normal text-muted">in all, seeded prices</span>
      </p>
      <p className="mt-1.5 text-[12px] leading-4 text-muted">
        {plan.composedBy === "model" ? "Picked by Sprout's model from the seeded catalog, then checked in code against the cap, every limit and every taste." : "Built by code from the seeded catalog, because the model did not answer."} Nothing is booked.
      </p>
    </section>
  );
}

/** "Not settled yet": what the coordinator does not know, said plainly instead of guessed. */
function OpenCard({ trip }: { trip: UiTrip }) {
  return (
    <section className={cardShell}>
      <CardLabel>Not settled yet</CardLabel>
      <p className="mt-0.5 text-[15px] leading-5">Nothing here is booked or promised.</p>
      <ul className="mt-3 space-y-2.5">
        {trip.unknowns.map((unknown) => (
          <li key={unknown} className="flex items-start gap-2.5">
            <CircleDashed className="mt-0.5 size-4 shrink-0 text-faint" strokeWidth={1.75} aria-hidden="true" />
            <p className="text-[14px] leading-5">{unknown}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const depositWord = { proposed: "Not yet", confirmed: "In", declined: "Not this time", failed: "Did not go through", refunded: "Went back" } as const;

function PotCard({ item, readOnly, onChanged }: { item: Extract<ChatItem, { kind: "trip-pot" }>; readOnly: boolean; onChanged: () => void }) {
  const { trip, planId, answerable, viewer, state } = item;
  const pot = trip.pot!;
  const [confirming, setConfirming] = useState<MemberId | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inPot = pot.deposits.filter((deposit) => deposit.status === "confirmed").reduce((sum, deposit) => sum + deposit.amount, 0);
  const held = pot.balance ?? inPot;
  const nameOf = (member: MemberId) => (member === viewer ? "You" : capital(personOf(trip, member).name));
  const open = state === "awaiting_humans";

  async function send(member: MemberId, choice: "in" | "out") {
    if (readOnly) return;
    setPending(true);
    setError(null);
    const result = await postTripJoin(planId, member, choice);
    setPending(false);
    if (!result.ok) setError(result.message);
    else setConfirming(null);
    onChanged();
  }

  const confirmingDeposit = confirming ? pot.deposits.find((deposit) => deposit.member === confirming) : undefined;
  const confirmingWallet = confirming ? pot.wallets.find((wallet) => wallet.member === confirming)?.balance ?? null : null;

  return (
    <section className={cardShell}>
      <CardLabel>Trip pot, {trip.title}</CardLabel>
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-[40px] font-bold leading-[46px]">{money(held)}</span>
        <span className="text-[17px] font-semibold text-muted">of {money(pot.target)}</span>
      </p>
      <div className="mt-2.5 flex gap-1.5" role="img" aria-label={`${pot.deposits.filter((deposit) => deposit.status === "confirmed").length} of ${pot.deposits.length} deposits in`}>
        {pot.deposits.map((deposit) => (
          <span key={deposit.member} className={`h-1.5 flex-1 rounded-full ${deposit.status === "confirmed" ? "bg-tracking" : "bg-bezel-line"}`} />
        ))}
      </div>
      <ul className="mt-3.5 space-y-3">
        {pot.deposits.map((deposit) => {
          const person = personOf(trip, deposit.member);
          const mine = answerable.includes(deposit.member);
          const canPut = open && mine && (deposit.status === "proposed" || deposit.status === "failed");
          const wallet = pot.wallets.find((entry) => entry.member === deposit.member)?.balance ?? null;
          const source =
            deposit.status === "confirmed"
              ? deposit.member === viewer
                ? "You confirmed it"
                : deposit.by === "seed"
                  ? `Seeded: the model did not answer, so ${person.name}'s profile joined`
                  : deposit.by === "person_model"
                    ? `Played by a model, confirmed it; ${person.muse} sent it`
                    : `${person.name} confirmed it${deposit.member === "aaron" ? "" : `, ${person.muse} sent it`}`
              : deposit.status === "failed"
                ? (deposit.error ?? "The deposit did not go through")
                : deposit.status === "refunded"
                  ? "Back in the trip wallet"
                  : mine && deposit.member === viewer
                    ? `Your trip wallet: ${wallet === null ? "seeded" : money(wallet)}`
                    : deposit.status === "declined"
                      ? "Passed on this one"
                      : "Has not confirmed yet";
          return (
            <li key={deposit.member} className="flex items-center gap-3">
              <PersonDisc name={nameOf(deposit.member)} size={28} />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold leading-5">{deposit.member === "kai" && mine ? "Kai" : nameOf(deposit.member)}</p>
                <p className="text-[12px] leading-4 text-muted">{source}</p>
              </div>
              {canPut ? (
                <button
                  type="button"
                  disabled={readOnly || pending}
                  onClick={() => setConfirming(deposit.member)}
                  className="shrink-0 rounded-full bg-accent px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
                >
                  Put in {money(deposit.amount)}
                </button>
              ) : deposit.status === "confirmed" ? (
                <span className="flex shrink-0 items-center gap-1 text-[15px] font-semibold text-tracking">
                  <CheckMark className="size-4" />
                  {money(deposit.amount)} in
                </span>
              ) : (
                <span className="shrink-0 text-[13px] text-muted">{depositWord[deposit.status]}</span>
              )}
            </li>
          );
        })}
      </ul>

      {confirming && confirmingDeposit ? (
        <div className="mt-4 animate-card-in rounded-group bg-group p-4">
          <p className="text-[13px] font-semibold leading-[18px] text-muted">{confirming === viewer ? "Put in the trip pot" : `Put in the trip pot for ${personOf(trip, confirming).name}`}</p>
          <p className="mt-0.5 text-[34px] font-bold leading-[40px]">{money(confirmingDeposit.amount)}</p>
          <dl className="mt-2 space-y-1.5 text-[14px] leading-5">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Trip wallet</dt>
              <dd className="font-semibold">{confirmingWallet === null ? "seeded" : `${money(confirmingWallet)} to ${money(confirmingWallet - confirmingDeposit.amount)}`}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">The pot after this</dt>
              <dd className="font-semibold">
                {money(held + confirmingDeposit.amount)} of {money(pot.target)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">If someone passes</dt>
              <dd className="font-semibold">Back to each of you</dd>
            </div>
          </dl>
          <p className="mt-3 text-[12px] font-semibold leading-4 text-muted">Why {money(confirmingDeposit.amount)}?</p>
          <ul className="mt-1 space-y-1">
            {pot.breakdown.map((line) => (
              <li key={line.label} className="text-[12px] leading-4">
                <span className="font-semibold">{line.label}</span> {money(line.amount)} <span className="text-muted">({line.source})</span>
              </li>
            ))}
          </ul>
          <div className="mt-3.5 grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(null)}
              className="rounded-full bg-surface px-3 py-2.5 text-[15px] font-semibold shadow-float disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={pending || readOnly}
              onClick={() => send(confirming, "in")}
              className="rounded-full bg-accent px-3 py-2.5 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 active:brightness-90 disabled:opacity-50"
            >
              Put in {money(confirmingDeposit.amount)}
            </button>
          </div>
          <button type="button" disabled={pending || readOnly} onClick={() => send(confirming, "out")} className="mt-2.5 w-full text-center text-[13px] font-semibold text-muted underline disabled:opacity-50">
            Not this time
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-[13px] leading-[18px] text-withheld">
          {error}
        </p>
      ) : null}
      <p className="mt-3.5 text-[12px] leading-4 text-muted">
        Each deposit goes in when that person confirms it. If anyone passes, every deposit goes back. Paper dollars in seeded trip wallets on the demo&apos;s local ledger, not the Capital One sandbox. Not real money.
      </p>
    </section>
  );
}

/** The three Muses of a trip side by side, overlapping, the reader's own in the middle and animated for what it is doing. */
export function GroupAvatars({ trip, mood, viewer }: { trip: UiTrip; mood: AvatarMood; viewer: MemberId }) {
  const order: MemberId[] = ["lisa", "aaron", "kai"];
  return (
    <div className="flex items-end justify-center">
      {order.map((member, index) => {
        const person = personOf(trip, member);
        const middle = index === 1;
        return (
          <span key={member} className={index === 0 ? "" : "-ml-3"} style={{ zIndex: middle ? 2 : 1 }}>
            <MuseAvatar agent={member} name={person.muse} size={middle ? 56 : 44} mood={member === viewer ? mood : undefined} />
          </span>
        );
      })}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Booking the trip with each person's yes (Lisa's plan): the progress, the flight seat, the hotel
// ---------------------------------------------------------------------------

const SIMULATED_BOOKING = "Simulated booking";

/** "Played by a model" or "seeded" beside a model-played person's own tap, the same as the pot row says it. */
function bySuffix(by: "person" | "person_model" | "seed" | null | undefined): string {
  return by === "person_model" ? ", played by a model" : by === "seed" ? ", seeded: the model did not answer" : "";
}

type Step = { key: string; label: string; state: "waiting" | "working" | "done" | "skipped"; found: string; detail: string };

function bookingSteps(trip: UiTrip, booking: UiBooking): Step[] {
  const seats = booking.seats.length;
  const hotel = booking.hotel;
  const dates = tripDates(trip);
  return [
    { key: "dates", label: "Dates", state: booking.datesHeld ? "done" : "working", found: dates, detail: "Held on all three calendars. Costs nothing, and anyone can remove the hold." },
    {
      key: "flights",
      label: "Flights",
      state: !booking.datesHeld ? "waiting" : seats === 3 ? "done" : "working",
      found: "All three seats booked",
      detail: `${seats} of 3 booked, each by its own person`,
    },
    {
      key: "hotel",
      label: "Hotel",
      state: !hotel ? "waiting" : hotel.state === "booked" ? "done" : hotel.state === "none_fit" ? "skipped" : "working",
      found: hotel?.state === "booked" ? hotel.option.label : "No hotel booked",
      detail:
        hotel?.state === "booked"
          ? `${money(hotel.option.cost)} each from your trip wallets, after all three said yes`
          : hotel?.state === "none_fit"
            ? "No stay is left that all three can do. Nothing was booked."
            : "Books only when all three say yes",
    },
    {
      key: "days",
      label: "Days",
      state: booking.daysHeld ? "done" : booking.hotel && booking.hotel.state !== "proposed" ? "working" : "waiting",
      found: booking.days.map((day) => day.label).join("; ") || "Free days",
      detail: "Free holds. Reserved, pay on the day.",
    },
  ];
}

/** The progress of the booking, a row at a time: a spinning row while Sprout is on it, a check when it is done, and the ledger's numbers at the end. */
function BookingCard({ trip, viewer }: { trip: UiTrip; viewer: MemberId }) {
  const booking = trip.booking!;
  const steps = bookingSteps(trip, booking);
  const mine = booking.wallets.find((wallet) => wallet.member === viewer)?.balance ?? null;
  const seat = booking.seats.find((entry) => entry.member === viewer);
  const stay = booking.hotel?.state === "booked" ? booking.hotel.booked.find((entry) => entry.member === viewer) : undefined;
  return (
    <section className={cardShell} aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <CardLabel>{booking.done ? "Trip booked" : "Booking the trip"}</CardLabel>
        <span className="rounded-full bg-group px-1.5 py-px text-[11px] font-semibold leading-[14px] text-muted">{SIMULATED_BOOKING}</span>
      </div>
      <h3 className="mt-0.5 text-[21px] font-bold leading-[26px]">{trip.title}</h3>
      <ul className="mt-3 divide-y divide-bezel-line">
        {steps.map((step) => (
          <li key={step.key} className="flex items-start gap-2.5 py-2.5">
            {step.state === "done" ? (
              <CheckMark className="mt-0.5 size-4" />
            ) : step.state === "working" ? (
              <CircleDashed className="mt-0.5 size-4 shrink-0 animate-spin text-accent [animation-duration:2s]" strokeWidth={1.75} aria-hidden="true" />
            ) : (
              <CircleDashed className="mt-0.5 size-4 shrink-0 text-faint" strokeWidth={1.75} aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold leading-[18px] text-muted">{step.label}</p>
              <p className={`text-[15px] leading-5 ${step.state === "done" || step.state === "skipped" ? "font-semibold" : "text-muted"}`}>
                {step.state === "done" || step.state === "skipped" ? step.found : step.state === "working" ? "In progress" : "Not yet"}
              </p>
              <p className="text-[13px] leading-[18px] text-muted">{step.detail}</p>
            </div>
          </li>
        ))}
      </ul>
      {booking.done ? (
        <div className="mt-1 rounded-group bg-group p-3 text-[13px] leading-[18px]">
          <p className="font-semibold">{viewer === "aaron" ? "Your numbers" : "Your numbers, from the ledger"}</p>
          {seat ? (
            <p>
              Seat {money(seat.amount)}: {money(seat.fromPot)} from the pot and {money(seat.fromWallet)} from your trip wallet
            </p>
          ) : null}
          {stay ? <p>Hotel {money(stay.amount)} from your trip wallet</p> : null}
          {mine !== null ? (
            <p className="font-semibold">
              Your trip wallet: {money(booking.walletStart)} to {money(mine)}
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="mt-2 text-[12px] leading-4 text-muted">
        {SIMULATED_BOOKING}, {trip.seededLabel.toLowerCase()}: paper dollars on the demo&apos;s local ledger. Nothing real was bought.
      </p>
    </section>
  );
}

/** Each person books their own seat: the three seeded flights, why each fits or not, and a button that says what it costs and where it comes from. */
function FlightCard({ item, readOnly, onChanged }: { item: Extract<ChatItem, { kind: "trip-flights" }>; readOnly: boolean; onChanged: () => void }) {
  const { trip, planId, answerable, viewer } = item;
  const booking = trip.booking!;
  const perPerson = trip.pot?.perPerson ?? 0;
  const seatOf = (member: MemberId) => booking.seats.find((seat) => seat.member === member);
  const ownMember = answerable.find((member) => !seatOf(member));
  const options = booking.flights;
  const [choice, setChoice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picked = ownMember ? (options.find((option) => option.id === choice && option.withinLimit[ownMember]) ?? options.find((option) => option.recommended && option.withinLimit[ownMember]) ?? options.find((option) => option.withinLimit[ownMember])) : undefined;
  const fromPot = picked ? Math.min(perPerson, picked.cost) : 0;
  const cap = trip.cap?.amount ?? 0;

  async function book() {
    if (readOnly || !ownMember || !picked) return;
    setPending(true);
    setError(null);
    const result = await postTripSeat(planId, ownMember, picked.id);
    setPending(false);
    if (!result.ok) setError(result.message);
    onChanged();
  }

  return (
    <section className={cardShell}>
      <div className="flex items-center justify-between gap-2">
        <CardLabel>Flights, book your own seat</CardLabel>
        <span className="rounded-full bg-group px-1.5 py-px text-[11px] font-semibold leading-[14px] text-muted">{SIMULATED_BOOKING}</span>
      </div>
      <ul className="mt-2.5 space-y-2">
        {options.map((option) => {
          const allowed = ownMember ? option.withinLimit[ownMember] : false;
          const selected = picked?.id === option.id;
          return (
            <li key={option.id}>
              <button
                type="button"
                disabled={!ownMember || !allowed || pending || readOnly}
                aria-pressed={selected}
                onClick={() => setChoice(option.id)}
                className={`flex w-full items-start gap-2.5 rounded-group border px-3 py-2 text-left transition-colors disabled:cursor-default ${selected ? "border-accent bg-surface" : "border-bezel-line bg-surface"} ${allowed || !ownMember ? "" : "opacity-60"}`}
              >
                <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${selected ? "bg-accent" : "bg-faint"}`} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold leading-5">
                    {option.label}, {money(option.cost)}
                  </span>
                  <span className="block text-[12px] leading-4 text-muted">
                    {option.recommended ? "Sprout's pick. " : ""}
                    {option.withinCap ? `Within the ${money(cap)} cap` : `Over the ${money(cap)} cap`}
                    {ownMember && !allowed ? ", and over your own limit" : ""}. {trip.seededLabel}.
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <ul className="mt-3 space-y-2">
        {trip.people.map((person) => {
          const seat = seatOf(person.member);
          const name = person.member === viewer ? "You" : capital(person.name);
          return (
            <li key={person.member} className="flex items-center gap-3">
              <PersonDisc name={name} size={28} />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold leading-5">{name}</p>
                <p className="text-[12px] leading-4 text-muted">
                  {seat
                    ? `${seat.label.split(",")[0]}, ${money(seat.fromPot)} pot + ${money(seat.fromWallet)} wallet${bySuffix(seat.by)}${seat.by !== "person" && person.member !== "aaron" ? `; ${person.muse} sent it` : ""}`
                    : person.member === ownMember
                      ? "Your seat"
                      : "Has not booked yet"}
                </p>
              </div>
              {seat ? (
                <span className="flex shrink-0 items-center gap-1 text-[15px] font-semibold">
                  <CheckMark className="size-4" />
                  {money(seat.amount)}
                </span>
              ) : (
                <span className="shrink-0 text-[13px] text-muted">Not yet</span>
              )}
            </li>
          );
        })}
      </ul>
      {ownMember && picked ? (
        <>
          <button
            type="button"
            disabled={pending || readOnly}
            onClick={book}
            className="mt-3.5 w-full rounded-full bg-accent px-4 py-2.5 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 active:brightness-90 disabled:opacity-50"
          >
            Book my seat, {money(picked.cost)}
          </button>
          <p className="mt-1.5 text-center text-[12px] leading-4 text-muted">
            {money(fromPot)} from the pot, {money(picked.cost - fromPot)} from your trip wallet
          </p>
        </>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-[13px] leading-[18px] text-withheld">
          {error}
        </p>
      ) : null}
      <p className="mt-2.5 text-[12px] leading-4 text-muted">Nothing is booked for you until you tap. The price comes out of your own share of the pot first.</p>
    </section>
  );
}

/** The hotel: Sprout's pick, why, each person's answer, and Looks good or Show me another. It books only when all three say yes. */
function HotelCard({ item, readOnly, onChanged }: { item: Extract<ChatItem, { kind: "trip-hotel" }>; readOnly: boolean; onChanged: () => void }) {
  const { trip, planId, answerable, viewer } = item;
  const hotel = trip.booking!.hotel!;
  const answerOf = (member: MemberId) => hotel.approvals.find((approval) => approval.member === member);
  const ownMember = answerable.find((member) => !answerOf(member));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function answer(choice: "yes" | "no") {
    if (readOnly || !ownMember) return;
    setPending(true);
    setError(null);
    const result = await postTripHotel(planId, ownMember, choice);
    setPending(false);
    if (!result.ok) setError(result.message);
    onChanged();
  }

  return (
    <section className={cardShell}>
      <div className="flex items-center justify-between gap-2">
        <CardLabel>Hotel, all three say yes</CardLabel>
        <span className="rounded-full bg-group px-1.5 py-px text-[11px] font-semibold leading-[14px] text-muted">{SIMULATED_BOOKING}</span>
      </div>
      <h3 className="mt-0.5 text-[17px] font-semibold leading-[22px]">{hotel.option.label}</h3>
      <p className="text-[15px] font-semibold leading-5">{money(hotel.option.cost)} each, from your trip wallets</p>
      <p className="mt-0.5 text-[13px] leading-[18px] text-muted">
        {hotel.why} {trip.seededLabel}.
      </p>
      {hotel.lower.length > 0 ? (
        <details className="mt-2 text-[12px] leading-4 text-muted">
          <summary className="cursor-pointer font-semibold">Why the others rank lower</summary>
          <ul className="mt-1 space-y-1">
            {hotel.lower.map((stay) => (
              <li key={stay.id}>
                {stay.label}, {money(stay.cost)}: {stay.reason}.
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <ul className="mt-3 space-y-2">
        {trip.people.map((person) => {
          const answered = answerOf(person.member);
          const name = person.member === viewer ? "You" : capital(person.name);
          return (
            <li key={person.member} className="flex items-center gap-3">
              <PersonDisc name={name} size={28} />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold leading-5">{name}</p>
                <p className="text-[12px] leading-4 text-muted">
                  {answered ? `${answered.answer === "yes" ? "Said yes" : "Said no"}${bySuffix(answered.by)}` : hotel.misfits[person.member] ? `Pebble will refuse: ${hotel.misfits[person.member]}` : "Has not answered yet"}
                </p>
              </div>
              {answered?.answer === "yes" ? <CheckMark className="size-4" /> : <span className="shrink-0 text-[13px] text-muted">{answered ? "No" : "Not yet"}</span>}
            </li>
          );
        })}
      </ul>
      {ownMember ? (
        <div className="mt-3.5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            disabled={pending || readOnly}
            onClick={() => answer("no")}
            className="rounded-full bg-group px-3 py-2.5 text-[15px] font-semibold transition-colors hover:bg-bubble-muse active:bg-bubble-muse disabled:opacity-50"
          >
            Show me another
          </button>
          <button
            type="button"
            disabled={pending || readOnly}
            onClick={() => answer("yes")}
            className="rounded-full bg-accent px-3 py-2.5 text-[15px] font-semibold text-white transition-[filter] hover:brightness-110 active:brightness-90 disabled:opacity-50"
          >
            Looks good
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-[13px] leading-[18px] text-withheld">
          {error}
        </p>
      ) : null}
      <p className="mt-2.5 text-[12px] leading-4 text-muted">Nothing is booked until all three say yes. A no brings the next best stay, and nothing that breaks a person&apos;s own limit is booked without their yes.</p>
    </section>
  );
}

type GroupItemKind = Extract<ChatItem, { kind: "group-line" | "trip-question" | "trip-budget" | "trip-itinerary" | "trip-open" | "trip-pot" | "trip-booking" | "trip-flights" | "trip-hotel" }>;

export function isGroupItem(item: ChatItem): item is GroupItemKind {
  return item.kind === "group-line" || item.kind.startsWith("trip-");
}

/** One item of the trip thread: a line from a person or a Muse, or a card. */
export function GroupItem({ item, readOnly, onChanged }: { item: GroupItemKind; readOnly: boolean; onChanged: () => void }) {
  switch (item.kind) {
    case "group-line":
      return <GroupBubble line={item.line} />;
    case "trip-question":
      return <QuestionCard planId={item.planId} member={item.member} forName={item.forName} range={item.range} route={item.route} readOnly={readOnly} onChanged={onChanged} />;
    case "trip-budget":
      return <BudgetCard trip={item.trip} />;
    case "trip-itinerary":
      return <ItineraryCard trip={item.trip} />;
    case "trip-open":
      return <OpenCard trip={item.trip} />;
    case "trip-pot":
      return <PotCard item={item} readOnly={readOnly} onChanged={onChanged} />;
    case "trip-booking":
      return <BookingCard trip={item.trip} viewer={item.viewer} />;
    case "trip-flights":
      return <FlightCard item={item} readOnly={readOnly} onChanged={onChanged} />;
    case "trip-hotel":
      return <HotelCard item={item} readOnly={readOnly} onChanged={onChanged} />;
  }
}
