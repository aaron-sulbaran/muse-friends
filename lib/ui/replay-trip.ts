import type { ActivityEvent, Decision, MemberId, Plan } from "@/lib/protocol";
import { TRIP } from "@/lib/seed/trip";

/*
 * A recorded trip, as it stood at one moment. The hangout's frames are rebuilt from message and plan times alone; a trip
 * keeps more on its plan (each person's answer, the cap, the outline, the pot and each deposit), so the same record is
 * cut by time here: an answer exists from when it was given, the cap and the outline from the rows that say Sprout set
 * and composed them, a deposit from when its person confirmed it. Pure, so Replay and its tests share it.
 */

const ms = (iso: string) => Date.parse(iso);

function sawEvent(events: ActivityEvent[], pattern: RegExp): boolean {
  return events.some((event) => event.kind === "plan_state" && pattern.test(event.text));
}

/** The plan with its trip, and the group's decisions, as of `time`; `events` are the ones already visible by then. */
export function tripAt(plan: Plan, events: ActivityEvent[], time: number): Plan {
  const trip = plan.trip;
  if (!trip) return plan;
  const members = plan.group?.members ?? [];
  const answers = Object.fromEntries(Object.entries(trip.answers).filter(([, answer]) => answer && ms(answer.at) <= time)) as typeof trip.answers;
  const composed = sawEvent(events, /composed \d+ lines/);
  const capSet = composed || sawEvent(events, /set a flight cap/);
  const pot = composed && trip.pot
    ? {
        ...trip.pot,
        deposits: Object.fromEntries(
          Object.entries(trip.pot.deposits).map(([member, deposit]) => [member, deposit && deposit.at && ms(deposit.at) <= time ? deposit : deposit ? { amount: deposit.amount, status: "proposed" as const } : deposit]),
        ) as typeof trip.pot.deposits,
      }
    : undefined;
  const decisions = Object.fromEntries(
    members.map((member): [MemberId, Decision] => {
      const status = pot?.deposits[member]?.status;
      return [member, status === "confirmed" || status === "refunded" ? "accepted" : status === "declined" ? "declined" : "pending"];
    }),
  ) as Record<MemberId, Decision>;
  return {
    ...plan,
    group: plan.group ? { ...plan.group, decisions } : plan.group,
    trip: {
      ...trip,
      answers,
      cap: capSet ? trip.cap : undefined,
      itinerary: composed ? trip.itinerary : undefined,
      pot,
      unknowns: composed ? trip.unknowns : [],
    },
  };
}

/** The local ledger as of `time` for a trip's accounts: every wallet at its start less its confirmed deposit, the pot holding the deposits in. */
export function tripLedgerAt(plan: Plan, ledger: Record<string, number> | undefined): Record<string, number> | undefined {
  const pot = plan.trip?.pot;
  if (!pot || !ledger) return ledger;
  const next = { ...ledger };
  let held = 0;
  for (const [member, deposit] of Object.entries(pot.deposits) as Array<[MemberId, NonNullable<(typeof pot.deposits)[MemberId]>]>) {
    const wallet = pot.wallets[member];
    const inPot = deposit.status === "confirmed";
    if (wallet) next[wallet.accountId] = TRIP.walletStart - (inPot ? deposit.amount : 0);
    if (inPot) held += deposit.amount;
  }
  next[pot.potAccountId] = held;
  return next;
}
