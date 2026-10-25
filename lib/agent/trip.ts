import { z } from "zod";
import { runAgentTurn } from "@/lib/model";
import { enforceSharePolicy } from "@/lib/policy";
import { transitionPlan } from "@/lib/plans";
import {
  AgentMessage,
  type ActivityEvent,
  type MemberId,
  type MessageRecord,
  type Plan,
  type PlanGroup,
  type TripAnswer,
  type TripItinerary,
  type TripLine,
  type TripPayload,
  type TripPot,
  type TripState,
} from "@/lib/protocol";
import { displayName, getPersona } from "@/lib/seed/fixtures";
import {
  CATALOG,
  catalogItem,
  catalogSource,
  groupNeedsLowEffort,
  ITINERARY_SHAPE,
  SEEDED_LABEL,
  TRIP,
  TRIP_PEOPLE,
  type CatalogItem,
  type SimulatedMember,
} from "@/lib/seed/trip";
import type { Store } from "@/lib/store";
import { LocalLedger } from "@/lib/nessie";
import { GROUP_COORDINATOR, GROUP_MEMBERS } from "./group";
import { newId } from "./ids";
import { decide } from "./lifecycle";
import { withLock } from "./lock";
import { nextThreadState } from "./thread";
import { roomLedger } from "./wallets";
import { localDeliver } from "./wire";
import { toCentralIso } from "./windows";

// The trip: a long-horizon plan for three on the group engine. The coordinator's Muse (Sprout) asks each member's Muse
// one bounded question and learns one taste or constraint; the member answers from its person (a human tap, or a model
// that plays the person, labeled); code builds the cap from the lowest ceiling; Sprout picks an itinerary from the
// seeded catalog and code checks it; Sprout proposes a pooled-pot deposit with a sourced breakdown; each person
// confirms their own deposit. The numbers are the people's and the seed's, copied by code: a model never authors one,
// and nothing is booked.
//
// The words on the wire are the agents'; the state is Plan.trip. Both ends validate (trip-rules.ts).

export type TripResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string; status: 404 | 409 | 422 | 502 };

const tripLock = (planId: string) => `trip:${planId}`;
type Options = { wallNow?: () => number };
const nowOf = (options: Options) => options.wallNow?.() ?? Date.now();

const OTHER_MEMBERS = GROUP_MEMBERS.filter((member) => member !== GROUP_COORDINATOR);

export function isTripPlan(plan: Plan | null | undefined): plan is Plan & { kind: "trip"; trip: TripState; group: PlanGroup } {
  return plan?.kind === "trip" && plan.trip !== undefined && plan.group !== undefined;
}

const row = (plan: Plan, at: string, kind: ActivityEvent["kind"], actor: ActivityEvent["actor"], text: string, extra: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id: newId("evt"),
  at,
  kind,
  actor,
  contextId: plan.contextId,
  planId: plan.id,
  text: text.slice(0, 240),
  ...extra,
});

async function putTrip(store: Store, plan: Plan, patch: Partial<TripState>, at: string): Promise<Plan> {
  const next: Plan = { ...plan, trip: { ...plan.trip!, ...patch }, updatedAt: at };
  await store.putPlan(next);
  return next;
}

const money = (amount: number) => `$${amount.toLocaleString("en-US")}`;

// ---------------------------------------------------------------------------
// Starting a trip
// ---------------------------------------------------------------------------

// The trip plan, its group and the sharing the new pair needs. The group chat that never made it out of the chat is the
// signal: nobody has the initiative, so Sprout makes it a plan.
export async function startTrip(store: Store, options: Options = {}): Promise<{ planId: string; groupId: string; contexts: PlanGroup["contexts"]; firstContextId: string }> {
  const now = nowOf(options);
  const at = toCentralIso(now);
  const groupId = newId("grp", now);
  const planId = newId("plan", now);
  const contexts: PlanGroup["contexts"] = Object.fromEntries(OTHER_MEMBERS.map((member) => [member, newId("ctx", now)]));
  const firstContextId = contexts[OTHER_MEMBERS[0]]!;

  const group: PlanGroup = {
    groupId,
    coordinator: GROUP_COORDINATOR,
    members: [...GROUP_MEMBERS],
    contexts,
    decisions: Object.fromEntries(GROUP_MEMBERS.map((member) => [member, "pending"])) as PlanGroup["decisions"],
    rounds: 0,
    quorum: "all",
  };
  const detected: Plan = {
    id: planId,
    contextId: firstContextId,
    initiator: "aaron",
    participants: ["aaron", "lisa"],
    state: "detected",
    decisions: { aaron: "pending", lisa: "pending" },
    group,
    kind: "trip",
    activity: { kind: "events", title: TRIP.title },
    window: { start: TRIP.start, end: TRIP.end },
    trip: {
      title: TRIP.title,
      destination: TRIP.destination,
      horizon: { label: TRIP.horizonLabel, start: TRIP.start, end: TRIP.end },
      range: { ...TRIP.range },
      answers: {},
      unknowns: [],
    },
    history: [{ state: "detected", at, note: "Trip requested" }],
    createdAt: at,
    updatedAt: at,
  };
  const plan = transitionPlan(detected, "negotiating", at, { note: "Sprout is asking each Muse" });

  const pair = (owner: MemberId, friend: MemberId) => ({ owner, friend, tier: "close" as const, categories: {} });
  const missing = (await Promise.all([store.getPolicy("aaron", "kai"), store.getPolicy("kai", "aaron")])).map((policy) => policy === null);
  await Promise.all([store.putPlan(plan), ...(missing[0] ? [store.putPolicy(pair("aaron", "kai"))] : []), ...(missing[1] ? [store.putPolicy(pair("kai", "aaron"))] : [])]);
  await store.appendEvent(row(plan, at, "plan_state", "agent", `${displayName(GROUP_COORDINATOR)} is turning "${TRIP.opener}" into a plan: ${TRIP.title}, for three`));
  return { planId, groupId, contexts, firstContextId };
}

// ---------------------------------------------------------------------------
// The wire: one message at a time, through the member's inbox, validated at both ends
// ---------------------------------------------------------------------------

type SendInput = { plan: Plan; from: MemberId; to: MemberId; type: (typeof import("@/lib/protocol").TRIP_TYPES)[number]; trip: TripPayload; note?: string; proof?: MessageRecord["proof"] };

async function sendTrip(store: Store, input: SendInput, options: Options): Promise<{ ok: true } | { ok: false; error: string }> {
  const { plan, from, to, type, trip } = input;
  const member = from === plan.group!.coordinator ? to : from;
  const contextId = plan.group!.contexts[member];
  if (!contextId) return { ok: false, error: "no thread for that member" };
  const thread = await store.getThread(contextId);
  const prior = (await store.listMessages(contextId)).map((record) => record.message);
  const at = toCentralIso(nowOf(options));
  const draft = {
    id: newId("msg", nowOf(options)),
    contextId,
    seq: (thread?.messageCount ?? 0) + 1,
    from,
    to,
    type,
    state: nextThreadState({ from, type, windows: undefined, trip }, prior),
    activity: { kind: "events" as const, title: TRIP.title },
    reason: "trip" as const,
    ...(input.note ? { note: input.note } : {}),
    trip,
    at,
  };
  const parsed = AgentMessage.safeParse(draft);
  if (!parsed.success) return { ok: false, error: `the message does not fit the protocol: ${z.prettifyError(parsed.error)}` };
  const policy = await store.getPolicy(from, to);
  const outcome = enforceSharePolicy({ message: parsed.data, policy, sender: getPersona(from) });
  const final = AgentMessage.safeParse(outcome.message);
  if (!final.success) return { ok: false, error: "the message does not fit the protocol after the policy scan" };
  const delivery = await localDeliver(store, from)({ record: { message: final.data, stamp: outcome.stamp, delivery: "delivered", proof: input.proof }, redaction: outcome.redaction });
  return delivery.ok ? { ok: true } : { ok: false, error: `the inbox rejected it (${delivery.status}): ${delivery.error}` };
}

// ---------------------------------------------------------------------------
// Round 1: ask, answer
// ---------------------------------------------------------------------------

export function questionPrompt(plan: Plan): string {
  const range = plan.trip!.range;
  return `Is ${money(range.low)} to ${money(range.high)} per person okay for the whole trip? Flights, stay and activities.`;
}

// Sprout asks each other member's Muse for its person's budget bound and one taste or constraint.
export async function askMembers(store: Store, planId: string, options: Options = {}): Promise<TripResult> {
  return withLock(tripLock(planId), async () => {
    const plan = await store.getPlan(planId);
    if (!isTripPlan(plan)) return { ok: false, error: "no such trip", status: 404 } as const;
    for (const member of OTHER_MEMBERS) {
      const contextId = plan.group.contexts[member]!;
      if ((await store.listMessages(contextId)).length > 0) continue;
      const sent = await sendTrip(
        store,
        {
          plan,
          from: GROUP_COORDINATOR,
          to: member,
          type: "trip_ask",
          trip: { planId, prompt: `What is ${TRIP_PEOPLE[member].name}'s most for the whole trip, and one thing they want from it?`, range: plan.trip.range },
        },
        options,
      );
      if (!sent.ok) return { ok: false, error: sent.error, status: 422 } as const;
    }
    return { ok: true } as const;
  });
}

const LIMIT_MIN = 100;
const LIMIT_MAX = 20_000;

// A person's answer to the bounded question: yes (the top of the range), no (the bottom), or their own limit. A
// simulated person never answers above their seeded ceiling, so the demo's numbers hold whatever a model says.
export async function recordAnswer(
  store: Store,
  input: { planId: string; member: MemberId; answer: "yes" | "no" | "limit"; limit?: number; by: TripAnswer["by"] },
  options: Options = {},
): Promise<TripResult<{ answer: TripAnswer }>> {
  return withLock(tripLock(input.planId), async () => {
    const plan = await store.getPlan(input.planId);
    if (!isTripPlan(plan)) return { ok: false, error: "no such trip", status: 404 } as const;
    if (plan.state !== "negotiating") return { ok: false, error: `the trip is ${plan.state}, not asking questions`, status: 409 } as const;
    if (!plan.group.members.includes(input.member)) return { ok: false, error: "that person is not in this trip", status: 422 } as const;
    if (plan.trip.answers[input.member]) return { ok: false, error: "this person already answered", status: 409 } as const;

    const range = plan.trip.range;
    let answer = input.answer;
    let limit = answer === "yes" ? range.high : answer === "no" ? range.low : Math.trunc(input.limit ?? Number.NaN);
    if (answer === "limit" && (!Number.isFinite(limit) || limit < LIMIT_MIN || limit > LIMIT_MAX)) {
      return { ok: false, error: `a limit is a whole number of dollars between ${LIMIT_MIN} and ${LIMIT_MAX}`, status: 422 } as const;
    }
    const person = TRIP_PEOPLE[input.member];
    if (input.by !== "person" && limit > person.ceiling) {
      answer = "limit";
      limit = person.ceiling;
    }

    const at = toCentralIso(nowOf(options));
    const recorded: TripAnswer = {
      answer,
      limit,
      taste: person.taste,
      ...(person.constraint ? { constraint: person.constraint } : {}),
      by: input.by,
      at,
    };
    const next = await putTrip(store, plan, { answers: { ...plan.trip.answers, [input.member]: recorded } }, at);
    const how = input.by === "person" ? "" : input.by === "seed" ? " (seeded answer)" : " (played by a model)";
    await store.appendEvent(row(next, at, "plan_state", input.by === "person" ? "human" : "agent", `${person.name} answered${how}: up to ${money(limit)}, ${person.taste}${person.constraint ? `, ${person.constraint}` : ""}`));

    // A member's Muse tells the coordinator what its person said, and only that. The coordinator's own person needs no message.
    if (input.member !== GROUP_COORDINATOR) {
      const sent = await sendTrip(
        store,
        {
          plan: next,
          from: input.member,
          to: GROUP_COORDINATOR,
          type: "trip_answer",
          trip: { planId: plan.id, answer, limit, taste: recorded.taste, ...(recorded.constraint ? { constraint: recorded.constraint } : {}), by: input.by },
        },
        options,
      );
      if (!sent.ok) return { ok: false, error: sent.error, status: 422 } as const;
    }
    return { ok: true, answer: recorded } as const;
  });
}

// ---------------------------------------------------------------------------
// Round 2: the cap, the itinerary, the pot
// ---------------------------------------------------------------------------

export function capOf(answers: TripState["answers"]): { amount: number; basis: string } | null {
  const entries = Object.entries(answers) as Array<[MemberId, TripAnswer]>;
  if (entries.length === 0) return null;
  const [member, lowest] = entries.reduce((best, entry) => (entry[1].limit < best[1].limit ? entry : best));
  const how = lowest.by === "person" ? "" : lowest.by === "seed" ? ", seeded answer" : ", played by a model";
  return { amount: lowest.limit, basis: `The lowest ceiling: ${TRIP_PEOPLE[member].name}'s ${money(lowest.limit)}${how}` };
}

type Pick = { flight: string; stay: string; excursions: string[] };

// Code's check of an itinerary, whoever picked it. Returns the lines or a sentence the model can act on.
export function checkItinerary(pick: Pick, cap: number, answers: TripState["answers"]): { ok: true; lines: TripLine[]; total: number } | { ok: false; error: string } {
  const ids = [pick.flight, ...(pick.stay ? [pick.stay] : []), ...pick.excursions];
  const items: CatalogItem[] = [];
  for (const id of ids) {
    const item = catalogItem(id);
    if (!item) return { ok: false, error: `${id} is not in the seeded catalog. Use ids from the catalog only.` };
    items.push(item);
  }
  if (new Set(ids).size !== ids.length) return { ok: false, error: "Each id may appear once." };
  const count = (kind: CatalogItem["kind"]) => items.filter((item) => item.kind === kind).length;
  if (count("flight") !== ITINERARY_SHAPE.flights || count("stay") !== ITINERARY_SHAPE.stays || count("excursion") !== ITINERARY_SHAPE.excursions) {
    return { ok: false, error: "Pick exactly 1 flight, 1 stay and 2 excursions." };
  }
  const total = items.reduce((sum, item) => sum + item.cost, 0);
  if (total > cap) return { ok: false, error: `That comes to ${money(total)} per person, over the cap of ${money(cap)}. Pick cheaper items.` };
  if (groupNeedsLowEffort(answers)) {
    const hard = items.filter((item) => item.effort !== "low");
    if (hard.length > 0) return { ok: false, error: `Someone in the group has low mobility. ${hard.map((item) => item.id).join(", ")} ask for walking or stairs. Pick low-effort items only.` };
  }
  for (const member of ["lisa", "kai"] as const) {
    const wanted = tasteTags(member);
    if (!items.some((item) => wanted.some((tag) => item.serves.includes(tag)))) {
      return { ok: false, error: `Nothing in this pick serves ${TRIP_PEOPLE[member].name}'s taste (${TRIP_PEOPLE[member].taste}). Add an excursion that does.` };
    }
  }
  const lines: TripLine[] = items.map((item) => ({ id: item.id, kind: item.kind, label: item.label, cost: item.cost, source: catalogSource(item), serves: item.serves }));
  return { ok: true, lines, total };
}

// The catalog tags that stand for a person's taste.
function tasteTags(member: MemberId): string[] {
  if (member === "kai") return ["anime"];
  if (member === "lisa") return ["food"];
  return ["ramen"];
}

// The same check, as a search: the cheapest pick that works and serves the most people. Used when the model is down,
// and by the tests to know that a valid pick exists.
export function fallbackPick(cap: number, answers: TripState["answers"]): Pick | null {
  const flights = CATALOG.filter((item) => item.kind === "flight");
  const stays = CATALOG.filter((item) => item.kind === "stay");
  const excursions = CATALOG.filter((item) => item.kind === "excursion");
  let best: { pick: Pick; total: number; served: number } | null = null;
  for (const flight of flights) {
    for (const stay of stays) {
      for (let first = 0; first < excursions.length; first += 1) {
        for (let second = first + 1; second < excursions.length; second += 1) {
          const pick: Pick = { flight: flight.id, stay: stay.id, excursions: [excursions[first].id, excursions[second].id] };
          const checked = checkItinerary(pick, cap, answers);
          if (!checked.ok) continue;
          const served = GROUP_MEMBERS.filter((member) => checked.lines.some((line) => tasteTags(member).some((tag) => line.serves.includes(tag)))).length;
          if (!best || served > best.served || (served === best.served && checked.total < best.total)) best = { pick, total: checked.total, served };
        }
      }
    }
  }
  return best?.pick ?? null;
}

const ComposeArgs = z.strictObject({
  flight: z.string().min(1).max(10),
  stay: z.string().min(1).max(10),
  excursions: z.array(z.string().min(1).max(10)).length(2),
  rationale: z.string().min(1).max(220).describe("One plain sentence: which line serves which person's taste or limit. No prices that are not in the catalog."),
  unknown: z.string().min(1).max(140).optional().describe("One thing you cannot do with this catalog, if any, said plainly"),
});

export const composeInstructions =
  "You are Sprout, a Muse that coordinates a trip for three friends. You received each friend's Muse's answer: a ceiling per person, one taste, and maybe a limit. " +
  "Pick the itinerary outline from the seeded catalog only: exactly 1 flight, 1 stay and 2 excursions, whose prices add up to no more than the cap, " +
  "that respects every limit and gives each friend's taste a line. Prices are seeded for the demo; nothing is booked and you never say it is. " +
  "If something cannot be done with this catalog, say so in the unknown field instead of inventing it. Answer only by calling compose_itinerary.";

function composeInput(plan: Plan & { trip: TripState }, cap: number): string {
  const people = (Object.entries(plan.trip.answers) as Array<[MemberId, TripAnswer]>)
    .map(([member, answer]) => `- ${TRIP_PEOPLE[member].name} (Muse ${TRIP_PEOPLE[member].muse}): up to ${money(answer.limit)} per person; taste: ${answer.taste}${answer.constraint ? `; limit: ${answer.constraint}` : ""}`)
    .join("\n");
  const catalog = CATALOG.map((item) => `${item.id} | ${item.kind} | ${item.label} | ${money(item.cost)} | serves: ${item.serves.join(", ") || "-"} | effort: ${item.effort}`).join("\n");
  return `Trip: ${plan.trip.title}. Budget cap per person: ${money(cap)} (${plan.trip.cap?.basis ?? "lowest ceiling"}).\nThe group:\n${people}\n\nSeeded catalog (prices per person, fictional):\n${catalog}`;
}

type Composition = { pick: Pick; composedBy: "model" | "fallback"; rationale: string; unknown?: string; proof?: MessageRecord["proof"] };

async function composeWithModel(plan: Plan & { trip: TripState }, cap: number): Promise<Composition | null> {
  let chosen: { pick: Pick; rationale: string; unknown?: string } | null = null;
  const result = await runAgentTurn({
    instructions: composeInstructions,
    input: composeInput(plan, cap),
    tools: [
      {
        name: "compose_itinerary",
        description: "Propose the itinerary: one flight id, one stay id and two excursion ids from the catalog, with one sentence on who each line serves.",
        parameters: {
          type: "object",
          properties: {
            flight: { type: "string", description: "A flight id, for example FL-1" },
            stay: { type: "string", description: "A stay id, for example ST-1" },
            excursions: { type: "array", items: { type: "string" }, description: "Exactly two excursion ids" },
            rationale: { type: "string", description: "One sentence: which line serves which person" },
            unknown: { type: "string", description: "One thing the catalog cannot do, if any" },
          },
          required: ["flight", "stay", "excursions", "rationale"],
          additionalProperties: false,
        },
      },
    ],
    handlers: {
      compose_itinerary: async (args) => {
        const parsed = ComposeArgs.safeParse(args);
        if (!parsed.success) throw new Error(z.prettifyError(parsed.error));
        const pick: Pick = { flight: parsed.data.flight, stay: parsed.data.stay, excursions: parsed.data.excursions };
        const checked = checkItinerary(pick, cap, plan.trip.answers);
        if (!checked.ok) throw new Error(checked.error);
        chosen = { pick, rationale: parsed.data.rationale, unknown: parsed.data.unknown };
        return { accepted: true, total: checked.total };
      },
    },
    requiredTools: ["compose_itinerary"],
    maxToolCalls: 3,
  });
  if (result.status !== "completed" || !chosen) return null;
  const c = chosen as { pick: Pick; rationale: string; unknown?: string };
  const last = result.calls.at(-1);
  return {
    pick: c.pick,
    composedBy: "model",
    rationale: c.rationale,
    unknown: c.unknown,
    proof: last ? { model: last.model, responseId: last.responseId, latencyMs: last.ms, inputTokens: last.inputTokens, outputTokens: last.outputTokens, reasoningTokens: last.reasoningTokens } : undefined,
  };
}

const roundTo10 = (value: number) => Math.round(value / 10) * 10;

// The pooled pot: three seeded trip wallets and the pot's own account on the demo's local ledger (paper dollars). The
// proposal's breakdown names the source of every line, so "why that amount?" has an answer built from the same numbers.
async function createPot(store: Store, itinerary: TripItinerary, members: MemberId[]): Promise<TripPot | { error: string }> {
  const ledger = new LocalLedger(roomLedger(store));
  const address = { street_number: "100", street_name: "Demo Way", city: "Austin", state: "TX", zip: "78701" };
  const wallets: TripPot["wallets"] = {};
  for (const member of members) {
    const customer = await ledger.createCustomer({ first_name: TRIP_PEOPLE[member].name === "You" ? "Sprout" : TRIP_PEOPLE[member].name, last_name: "Muse Demo", address });
    if (customer.error !== null) return { error: customer.error };
    const account = await ledger.createAccount(customer.data.id, { nickname: `${TRIP_PEOPLE[member].name}'s trip wallet`, balance: TRIP.walletStart });
    if (account.error !== null) return { error: account.error };
    wallets[member] = { accountId: account.data.id, balance: account.data.balance };
  }
  const customer = await ledger.createCustomer({ first_name: "Trip", last_name: "Pot Demo", address });
  if (customer.error !== null) return { error: customer.error };
  const pot = await ledger.createAccount(customer.data.id, { nickname: "Trip pot", balance: 0 });
  if (pot.error !== null) return { error: pot.error };

  const raw = Math.round((itinerary.total * TRIP.depositPercent) / 100);
  const perPerson = Math.max(10, roundTo10(raw));
  const target = perPerson * members.length;
  return {
    source: "local",
    potAccountId: pot.data.id,
    wallets,
    perPerson,
    target,
    breakdown: [
      { label: "Itinerary, per person", amount: itinerary.total, source: `${SEEDED_LABEL}: ${itinerary.lines.map((line) => line.id).join(", ")}` },
      { label: `Up-front share, ${TRIP.depositPercent}%`, amount: raw, source: `Sprout's rule: ${TRIP.depositPercent}% up front` },
      { label: "Rounded to the nearest $10", amount: perPerson, source: "Sprout's rule" },
      { label: `Pot target, ${members.length} people`, amount: target, source: `${members.length} times the deposit` },
    ],
    deposits: Object.fromEntries(members.map((member) => [member, { amount: perPerson, status: "proposed" as const }])),
  };
}

// Once every person has answered: the cap, the itinerary, the pot, and the proposal to each member's Muse.
export async function proposeTrip(store: Store, planId: string, options: Options = {}): Promise<TripResult> {
  return withLock(tripLock(planId), async () => {
    const plan = await store.getPlan(planId);
    if (!isTripPlan(plan)) return { ok: false, error: "no such trip", status: 404 } as const;
    if (plan.trip.itinerary) return { ok: true } as const;
    if (!plan.group.members.every((member) => plan.trip.answers[member])) return { ok: false, error: "not everyone has answered yet", status: 409 } as const;
    if (plan.state !== "negotiating") return { ok: false, error: `the trip is ${plan.state}`, status: 409 } as const;

    const at = toCentralIso(nowOf(options));
    const cap = capOf(plan.trip.answers)!;
    const withCap = await putTrip(store, plan, { cap }, at);
    await store.appendEvent(row(withCap, at, "plan_state", "agent", `${displayName(GROUP_COORDINATOR)} set a budget cap of ${money(cap.amount)} per person. ${cap.basis}`));

    // The model picks among the catalog and code checks it; when the model is down a code-built pick stands in, labeled.
    let composition: Composition | null = null;
    try {
      composition = await composeWithModel(withCap as Plan & { trip: TripState }, cap.amount);
    } catch (error) {
      console.error("trip composition failed", error);
    }
    if (!composition) {
      const pick = fallbackPick(cap.amount, plan.trip.answers);
      if (!pick) {
        const dropped = transitionPlan({ ...withCap, trip: { ...withCap.trip!, unknowns: ["Nothing in the seeded catalog fits this cap and these limits."] } }, "dropped", at, { note: "No itinerary fits the cap", dropReason: "no_overlap" });
        await store.putPlan(dropped);
        await store.appendEvent(row(dropped, at, "plan_state", "system", `Trip dropped: nothing in the seeded catalog fits ${money(cap.amount)} per person with these limits`));
        return { ok: false, error: "nothing in the seeded catalog fits", status: 422 } as const;
      }
      composition = { pick, composedBy: "fallback", rationale: "Built by code from the seeded catalog because the model did not answer: cheapest pick that fits every limit and serves the most tastes." };
    }
    const checked = checkItinerary(composition.pick, cap.amount, plan.trip.answers);
    if (!checked.ok) return { ok: false, error: checked.error, status: 422 } as const;
    const itinerary: TripItinerary = { lines: checked.lines, total: checked.total, composedBy: composition.composedBy, rationale: composition.rationale };

    const pot = await createPot(store, itinerary, plan.group.members);
    if ("error" in pot) return { ok: false, error: `the pot could not be set up: ${pot.error}`, status: 502 } as const;

    // What Sprout does not know, said plainly. The model's own unknown is kept when it fits the limit.
    const unknowns = [
      "Real prices, seats and rooms: I do not know them. Every price here is seeded for the demo, and nothing is booked.",
      ...(composition.unknown ? [composition.unknown] : []),
      ...(!checked.lines.some((line) => line.serves.includes("film photography")) ? ["Film photography has no low-effort option in the seeded catalog, so it is not in the outline."] : []),
    ].slice(0, 4);

    const next = await putTrip(store, withCap, { itinerary, pot, unknowns }, at);
    await store.appendEvent(row(next, at, "plan_state", "agent", `${displayName(GROUP_COORDINATOR)} composed ${checked.lines.length} lines at ${money(checked.total)} per person (${composition.composedBy === "model" ? "picked by the model, checked by code" : "built by code, the model did not answer"}) and a ${money(pot.perPerson)} pot deposit each`));

    for (const member of OTHER_MEMBERS) {
      const sent = await sendTrip(
        store,
        { plan: next, from: GROUP_COORDINATOR, to: member, type: "trip_plan", trip: { planId, cap: cap.amount, lines: checked.lines.map((line) => line.id), total: checked.total, deposit: pot.perPerson }, proof: composition.proof },
        options,
      );
      if (!sent.ok) return { ok: false, error: sent.error, status: 422 } as const;
    }
    const waiting = transitionPlan((await store.getPlan(planId))!, "awaiting_humans", at, { note: "Itinerary and pot deposit proposed" });
    await store.putPlan(waiting);
    await store.appendEvent(row(waiting, at, "plan_state", "system", "The itinerary and the pot deposit wait on all 3 people. Nothing is booked."));
    return { ok: true } as const;
  });
}

// ---------------------------------------------------------------------------
// Round 3: each person joins and funds their own deposit, or is out
// ---------------------------------------------------------------------------

// The one deliberate step (D28): the person confirms, and only then does money move, from their own seeded trip wallet
// into the pot. The deposit is recorded with its ledger ids, the member's Muse tells the coordinator, and the person's
// yes goes through the same lifecycle as any plan.
export async function confirmJoin(store: Store, input: { planId: string; member: MemberId }, options: Options = {}): Promise<TripResult<{ plan: Plan }>> {
  const moved = await withLock(tripLock(input.planId), async (): Promise<TripResult<{ plan: Plan; ledgerRef: string }>> => {
    const plan = await store.getPlan(input.planId);
    if (!isTripPlan(plan)) return { ok: false, error: "no such trip", status: 404 };
    const pot = plan.trip.pot;
    if (plan.state !== "awaiting_humans" || !pot) return { ok: false, error: `the trip is ${plan.state}, not waiting for a deposit`, status: 409 };
    if (!plan.group.members.includes(input.member)) return { ok: false, error: "that person is not in this trip", status: 422 };
    const deposit = pot.deposits[input.member];
    const wallet = pot.wallets[input.member];
    if (!deposit || !wallet || deposit.status === "confirmed" || deposit.status === "declined") return { ok: false, error: "this person already decided", status: 409 };
    if (plan.group.decisions[input.member] !== "pending") return { ok: false, error: "this person already decided", status: 409 };

    const ledger = new LocalLedger(roomLedger(store));
    const at = toCentralIso(nowOf(options));
    const reason = `Trip pot deposit, ${plan.trip.title}`;
    const withdrawn = await ledger.withdraw(wallet.accountId, { amount: deposit.amount, description: reason });
    let failure: string | null = withdrawn.error;
    let depositId: string | undefined;
    if (withdrawn.error === null) {
      const deposited = await ledger.deposit(pot.potAccountId, { amount: deposit.amount, description: reason });
      if (deposited.error === null) depositId = deposited.data.id;
      else {
        failure = deposited.error;
        await ledger.deposit(wallet.accountId, { amount: deposit.amount, description: "Refund, the pot did not take the deposit" });
      }
    }
    const balance = await ledger.getAccount(wallet.accountId);
    const wallets = { ...pot.wallets, [input.member]: { accountId: wallet.accountId, balance: balance.error === null ? balance.data.balance : wallet.balance } };

    if (failure !== null || !depositId || withdrawn.error !== null) {
      const failed = { ...deposit, status: "failed" as const, error: (failure ?? "the deposit did not go through").slice(0, 160), at };
      await putTrip(store, plan, { pot: { ...pot, wallets, deposits: { ...pot.deposits, [input.member]: failed } } }, at);
      await store.appendEvent(row(plan, at, "payment_failed", "system", `${TRIP_PEOPLE[input.member].name}'s pot deposit did not go through: ${failed.error}. Nothing moved.`));
      return { ok: false, error: failed.error, status: 502 };
    }
    const confirmed = { amount: deposit.amount, status: "confirmed" as const, withdrawalId: withdrawn.data.id, depositId, at };
    const next = await putTrip(store, plan, { pot: { ...pot, wallets, deposits: { ...pot.deposits, [input.member]: confirmed } } }, at);
    await store.appendEvent(
      row(next, at, "payment_sent", "human", `${TRIP_PEOPLE[input.member].name} put ${money(deposit.amount)} in the trip pot: paper dollars on the demo ledger (withdrawal ${withdrawn.data.id}, deposit ${depositId})`),
    );
    return { ok: true, plan: next, ledgerRef: depositId };
  });
  if (!moved.ok) return moved;

  const plan = moved.plan;
  if (input.member !== GROUP_COORDINATOR) {
    const sent = await sendTrip(store, { plan, from: input.member, to: GROUP_COORDINATOR, type: "trip_reply", trip: { planId: input.planId, choice: "in", deposit: plan.trip!.pot!.perPerson, ledgerRef: moved.ledgerRef } }, options);
    if (!sent.ok) return { ok: false, error: sent.error, status: 422 };
  }
  const decided = await decide(store, { planId: input.planId, agent: input.member, choice: "accept" }, options);
  if (!decided.ok) return { ok: false, error: decided.error, status: decided.status };
  return { ok: true, plan: decided.value.plan };
}

// A person is out: nothing moves, the member's Muse says so, and the plan drops for all three, as any plan does.
export async function declineJoin(store: Store, input: { planId: string; member: MemberId }, options: Options = {}): Promise<TripResult<{ plan: Plan }>> {
  const marked = await withLock(tripLock(input.planId), async (): Promise<TripResult<{ plan: Plan }>> => {
    const plan = await store.getPlan(input.planId);
    if (!isTripPlan(plan)) return { ok: false, error: "no such trip", status: 404 };
    const pot = plan.trip.pot;
    if (plan.state !== "awaiting_humans" || !pot) return { ok: false, error: `the trip is ${plan.state}, not waiting for a deposit`, status: 409 };
    const deposit = pot.deposits[input.member];
    if (!deposit || deposit.status === "confirmed" || deposit.status === "declined" || plan.group.decisions[input.member] !== "pending") return { ok: false, error: "this person already decided", status: 409 };
    const at = toCentralIso(nowOf(options));
    const next = await putTrip(store, plan, { pot: { ...pot, deposits: { ...pot.deposits, [input.member]: { ...deposit, status: "declined", at } } } }, at);
    return { ok: true, plan: next };
  });
  if (!marked.ok) return marked;
  if (input.member !== GROUP_COORDINATOR) {
    const sent = await sendTrip(store, { plan: marked.plan, from: input.member, to: GROUP_COORDINATOR, type: "trip_reply", trip: { planId: input.planId, choice: "out" } }, options);
    if (!sent.ok) return { ok: false, error: sent.error, status: 422 };
  }
  const decided = await decide(store, { planId: input.planId, agent: input.member, choice: "decline" }, options);
  if (!decided.ok) return { ok: false, error: decided.error, status: decided.status };
  return { ok: true, plan: decided.value.plan };
}

// ---------------------------------------------------------------------------
// Driving the trip: the people a model plays, in order
// ---------------------------------------------------------------------------

/** What plays a simulated person: one real model call each, injected so a test can script it. */
export type TripPlayers = {
  answers: (member: SimulatedMember, range: { low: number; high: number }) => Promise<{ answer: "yes" | "no" | "limit"; limit?: number }>;
  joins: (member: SimulatedMember, summary: string) => Promise<{ choice: "in" | "out" }>;
};

export function planSummary(plan: Plan): string {
  const trip = plan.trip!;
  const lines = trip.itinerary?.lines.map((line) => `${line.label} (${money(line.cost)})`).join("; ") ?? "";
  return `${trip.title}. Itinerary per person, ${money(trip.itinerary?.total ?? 0)} in all: ${lines}. Sprout asks for a ${money(trip.pot?.perPerson ?? 0)} deposit into a shared pot. Do you want to be in?`;
}

// Moves the trip along as far as it can without a human: the model-played people answer and join, the coordinator
// composes once everyone has answered. A person on a phone stops it, and their tap calls this again. Idempotent.
export async function driveTrip(store: Store, planId: string, players: TripPlayers, options: Options = {}): Promise<void> {
  await withLock(`drive:${planId}`, async () => {
    for (let step = 0; step < 4; step += 1) {
      const room = await store.getRoom();
      const plan = await store.getPlan(planId);
      if (!isTripPlan(plan) || plan.state === "dropped" || plan.state === "confirmed") return;
      const simulated = room.simulatedFriend ? OTHER_MEMBERS : [];

      if (plan.state === "negotiating") {
        if ((await store.listMessages(plan.group.contexts[OTHER_MEMBERS[0]]!)).length === 0) await askMembers(store, planId, options);
        const unanswered = simulated.filter((member) => !plan.trip.answers[member]);
        await Promise.all(
          unanswered.map(async (member) => {
            let played: Awaited<ReturnType<TripPlayers["answers"]>> | null = null;
            try {
              played = await players.answers(member as SimulatedMember, plan.trip.range);
            } catch (error) {
              console.error(`${member} did not answer the trip question`, error);
            }
            // A model that does not answer is replaced by the seeded profile, and the answer says so.
            await recordAnswer(store, played ? { planId, member, answer: played.answer, limit: played.limit, by: "person_model" } : { planId, member, answer: "limit", limit: TRIP_PEOPLE[member].ceiling, by: "seed" }, options);
          }),
        );
        const fresh = await store.getPlan(planId);
        if (isTripPlan(fresh) && fresh.group.members.every((member) => fresh.trip.answers[member])) await proposeTrip(store, planId, options);
        else return;
      } else if (plan.state === "awaiting_humans") {
        const waiting = simulated.filter((member) => plan.group.decisions[member] === "pending" && plan.trip.pot?.deposits[member]?.status !== "confirmed");
        if (waiting.length === 0) return;
        await Promise.all(
          waiting.map(async (member) => {
            let choice: "in" | "out" = "in";
            try {
              choice = (await players.joins(member as SimulatedMember, planSummary(plan))).choice;
            } catch (error) {
              console.error(`${member} did not answer the trip proposal`, error);
              return; // never fake a person's yes: the card stays for a human
            }
            if (choice === "in") await confirmJoin(store, { planId, member }, options);
            else await declineJoin(store, { planId, member }, options);
          }),
        );
      } else {
        return;
      }
    }
  });
}
