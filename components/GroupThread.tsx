"use client";

import { CircleDashed } from "lucide-react";
import { useState } from "react";
import type { ChatItem } from "@/lib/ui/chat";
import { postTripJoin } from "@/lib/ui/actions";
import { answerWord, money, personOf, servedBy, tripDates, type GroupLine } from "@/lib/ui/group";
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

type GroupItemKind = Extract<ChatItem, { kind: "group-line" | "trip-question" | "trip-budget" | "trip-itinerary" | "trip-open" | "trip-pot" }>;

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
  }
}
