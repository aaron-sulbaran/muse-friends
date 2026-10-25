# Muse Friends: technical spec

Status: v2.1, Sat Oct 24, 2026. Smoke tests 1 to 3 passed on live Muse Spark at 8:45pm (ping 1.9s; tool called 10 of 10 times, zod accepted 9 first try and 1 after one repair). Product requirements are in [PRD.md](PRD.md); requirement ids (R1 and so on) refer to it.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js (App Router), TypeScript strict, Tailwind |
| Agents | OpenAI SDK with `baseURL: "https://api.meta.ai/v1"` and `apiKey: process.env.MODEL_API_KEY` (passed explicitly; the SDK does not read that variable), model `muse-spark-1.3`, Responses API (`client.responses.create`) with function tools. The message schema is the parameters of the `send_to_friend_agent` tool, zod-parsed on receipt |
| Validation | zod (the same schemas, converted to JSON schema, are the tool parameters) |
| State | `Store` interface with two implementations: Supabase (Postgres) in production, and an in-memory store persisted to `data/store.json` for local development |
| Live UI | Polling `/api/state` every second |
| Handoff | `https://wa.me/?text=<encodeURIComponent(draft)>` click-to-chat with no phone number, plus a copy-draft fallback button; `.ics` file for the calendar hold, served by `GET /api/plans/[id]/hold.ics` |
| Package manager | pnpm |

Env: `MODEL_API_KEY` (Meta Model API). Optional: `MODEL_BASE_URL` and `MODEL_ID` to point at another provider that offers the Responses API with function tools; a Chat Completions only provider would need a second loop in `lib/model.ts`.

## Layout

```
app/
├── page.tsx                    demo: two phones + agent channel inspector + demo controls
├── api/agents/[id]/inbox/      POST: validate and persist an AgentMessage, answer 202, then run that agent's turn after responding
├── agents/[id]/.well-known/agent-card.json/route.ts   GET: the agent card, A2A v0.3 field names pinned
├── api/signals/                POST: inject a seeded signal (e.g. "Lisa sent Aaron a reel")
├── api/plans/[id]/decision/    POST: a human accepts or declines a recommendation
├── api/plans/[id]/hold.ics/route.ts   GET: the calendar hold, returned as text/calendar; charset=utf-8
├── api/plans/[id]/settle/      POST: a person asks their Muse to settle up (payments)
├── api/clock/                  POST: demo clock fast-forward
└── api/state/                  GET: threads, messages, plans, cards, for the UI
lib/
├── protocol.ts                 zod schemas: AgentMessage, Plan, Recommendation, SharePolicy
├── agent/runtime.ts            one agent turn: context + inbox + thread history -> Muse Spark -> tool calls
├── agent/tools.ts              tool definitions and handlers
├── agent/prompts.ts            system prompt per agent
├── policy.ts                   enforceSharePolicy() at send, validateIncoming() at receive; strips disallowed categories, records redactions
├── plans.ts                    plan lifecycle transitions (pure, unit tested)
├── store/                      Store interface + memory implementation
├── model.ts                    the one place that knows the provider (baseURL, model, key)
└── seed/                       personas: aaron.json, lisa.json (calendar, interests, signals, policies)
components/
├── Phone.tsx, MuseChat.tsx, RecommendationCard.tsx
├── Inspector.tsx               live agent messages, redactions, plan state timeline
└── DemoControls.tsx            inject signal, fast-forward clock, reset, replay
```

## Protocol (R3)

Every agent-to-agent message is one of seven types (five for negotiating, two for payments), validated with zod on send and on receipt. The vocabulary is A2A-shaped: a thread is a `contextId`, and `state` borrows A2A v0.3 task-state names. No A2A SDK is used and the inbox does not implement the A2A methods; it is a plain HTTP inbox. The sender POSTs the message to the peer's inbox with a bearer header. The inbox validates it, persists it, answers `202` with the task state, and runs the turn after responding, so a chain of agent-to-agent calls never waits on a model call. Each agent also serves an agent card that pins A2A v0.3 field names (current A2A docs show v1.0 names, which are not used here).

```ts
type AgentMessage = {
  id: string;
  contextId: string;        // the thread
  seq: number;              // position in the thread, 1 to 6
  from: AgentId;            // "aaron" | "lisa"
  to: AgentId;
  type: "intent" | "propose" | "counter" | "accept" | "decline" | "payment" | "payment_received";   // the last two: see Payments
  state: "working" | "input-required" | "completed" | "rejected" | "failed";
  activity?: { kind: Category; title: string; place?: string };   // title: max 60 characters
  windows?: Array<{ start: string; end: string }>;   // free windows only; ISO, Central; max 3
  reason: "both_free" | "interest_match" | "no_overlap" | "cap_reached" | "settle_up";
  note?: string;            // max 140 characters, scanned at send
  shared?: Partial<Record<Category, unknown>>;       // allowlist-projected, never availability
  payment?: Payment;        // only on payment and payment_received; see Payments
  at: string;
};

type Category = "food" | "events" | "availability" | "location" | "interests";
```

`state` follows the negotiation:

| `state` | When |
|---|---|
| `working` | the agents are negotiating |
| `input-required` | both agents accepted; the plan is `awaiting_humans` |
| `completed` | the plan is `scheduled` |
| `rejected` | a `decline` ended the thread |
| `failed` | the thread was `dropped` at the cap |

The schema is `.strict()` and every limit below is enforced in code, not in the prompt:

- `reason` is an enum. `note` is optional free text capped at 140 characters, and `enforceSharePolicy` scans it at send for off-category values and private event titles (see Privacy).
- `shared` is built by an allowlist projection of what the policy permits, not copied from the model's output; an unknown key fails the parse. Availability never travels in `shared`: it appears only as `windows`, which are free windows, at most 3.
- A zod `.refine` checks that every window is a subset of a free block returned by the sender's `get_my_calendar`. On a failure the runtime re-prompts once, then drops that window from the message; a `propose` left with no windows is sent as a `counter` with reason `no_overlap`.
- Scheduling is set intersection, so code does it: the runtime intersects the two sides' verified free windows, and the model only picks the activity and the wording.

A thread ends on `accept` from both sides or on `decline`. It is capped at **6 messages**: the sixth must be a forced `accept` or `decline`, and a thread that still has neither is marked `dropped`, with a reason. Each thread also keeps a ledger of rejected-window hashes in the Store; a message that re-proposes a rejected window is blocked in code at send.

## Agents (R1, R2)

Each agent is a separate Muse Spark loop. An agent turn gets:

- its system prompt, sent as `instructions` (who it serves, the rules: never invent availability, ask the human before committing, keep turns short)
- its own seeded context, through tools only
- the thread history it is party to

It never reads the other agent's context. That boundary is the point.

Tools:

| Tool | Does |
|---|---|
| `get_my_calendar(range)` | Busy and free blocks for this agent's human |
| `get_my_interests(category?)` | Interests by category |
| `get_recent_signals()` | Seeded signals (reels sent, places saved) |
| `send_to_friend_agent(friend, message)` | Validates, runs `enforceSharePolicy`, delivers to the friend's inbox |
| `surface_to_human(planId, card)` | Creates a recommendation card for this agent's human |
| `update_plan(planId, transition)` | Moves the plan through its lifecycle |

The runtime drives each turn with the Responses API in stateless mode, which Meta recommends and which measured far faster on Oct 24: 0.3 to 1.0 seconds per follow-up call, against 9 to 12.5 seconds for a `previous_response_id` chain (n=11, any output size).

1. The first `client.responses.create` call sends the system prompt as `instructions`, the tools, `reasoning: { effort: "low" }`, `store: false`, `include: ["reasoning.encrypted_content"]`, and the thread history rebuilt from the Store as input.
2. For each `function_call` in the response, the runtime runs the handler and appends a `function_call_output` with the same `call_id`.
3. Every follow-up call replays the previous output items, including the encrypted reasoning items, plus the new outputs as input, and resends `instructions`, `tools`, and the reasoning effort. If a replayed reasoning item is rejected with a `400`, the runtime drops the reasoning items and retries once. `MODEL_CHAIN_MODE=chain` switches to the `previous_response_id` chain for comparison only.
4. A response with no `function_call` ends the turn.

Temperature stays unset. Tool arguments are not guaranteed to validate, so every handler zod-parses its own arguments, and a failure goes back to the model as tool output so it can repair the call. The message schema is the parameters of the `send_to_friend_agent` tool (see Protocol); those parameter schemas omit `strict: true`, since optional fields cannot satisfy it, and the zod parse is the enforcement. `text.format` is not used with tools.

The runtime caps tool calls per turn at 6. Because `tool_choice` accepts only `"auto"`, the model can answer in prose instead of calling `send_to_friend_agent`. A nudge-and-retry guard covers that: when a reply has no tool call where one is expected, the runtime appends a short instruction to call the tool and makes one more call in the chain. If that call also has no tool call, the turn ends and the thread is marked `failed` with reason `cap_reached`, so the inspector shows why.

## Privacy (R4, R9)

```ts
type SharePolicy = { friend: AgentId; tier: "close" | "friend" | "off"; categories: Partial<Record<Category, boolean>>; payments?: { enabled: boolean; capPerPlan: number } };
```

`enforceSharePolicy(message, policy)` runs inside `send_to_friend_agent`, in code, after the model has written the message. It removes `shared` keys for categories that are off, blanks `activity.place` when location is off, scans `note` for off-category values and private event titles, and appends a `Redaction` record (`{ messageId, removed: Category[] }`) that the inspector shows. Default for a new friend is `off`: nothing is shared until the user opts in.

Prompts alone leak, so enforcement does not rely on the model following instructions. It happens at send and is re-validated at receive. `validateIncoming(message)`, next to `enforceSharePolicy` in `policy.ts`, runs in the inbox before it answers `202`: the same `.strict()` parse and length caps, the `seq` cap, and a check that `from` matches the authenticated sender. A message that fails is rejected with a `4xx` and shown in the inspector.

## Plan lifecycle (R7, R8)

```
detected -> negotiating -> awaiting_humans -> confirmed -> scheduled -> reminded -> happened -> followed_up
                     \-> dropped        \-> dropped (a human declined)
```

`plans.ts` holds the transition table as a pure function. Invalid transitions throw, and are unit tested.

- `confirmed`: both humans accepted. The draft opens through the `wa.me` link; the user picks the contact, so no phone number is stored. The copy-draft button is the fallback if the link does not open.
- `scheduled`: the `.ics` is served by `api/plans/[id]/hold.ics` (`Content-Type: text/calendar; charset=utf-8`, an attachment named `hold.ics`) and the plan has a time. The file carries `UID`, `DTSTAMP`, `DTSTART`, `DTEND` (UTC) and `SUMMARY`, with CRLF line endings.
- `reminded` and `happened`: driven by the demo clock (`/api/clock`). Crossing the reminder time triggers each agent's reminder turn; crossing the end time marks it happened.
- `followed_up`: the next-day agent turn asks its human whether to repeat it.

## Payments (D22, D28)

Friend-to-friend money, on Capital One's Nessie sandbox (paper dollars, whole numbers only). The agents hold the tools; the code holds the limits; since D28 the person holds the last step: **the agent prepares and explains a payment, the person confirms it, and nothing moves without that confirm, even under the cap.** Behind `PAYMENTS=off` the whole feature disappears (no wallets, tools, or routes).

**Wallets.** Each seat gets a Nessie customer and one checking account, created at Reset and kept on the room (jsonb, no migration): Sprout starts with $120, Mochi with $80 (the simulated friend uses Mochi's). A Reset puts the same accounts back to their starting balance instead of creating new ones. `NESSIE_KEY` (sent as `?key=`, never logged) selects the real sandbox at `https://api.nessieisreal.com`. Its writes land as real records (withdrawals and deposits with ids you can read back), but the sandbox never moves an account's `balance` field (checked live), so the balance is ours: `NessieWithLedger` writes the Nessie transaction first, then moves the balance in the room's ledger, and the wallet chip and the payment cards read that ledger, never the sandbox balance. Without a key a local ledger with the same shapes stands in, backed by the room so every instance agrees, and the snapshot says `sandbox: { connected: false, text: "Sandbox not connected, local ledger" }` (shown, never hidden). A wallet keeps the ledger it was created on until the next Reset. Everything written to the real sandbox is readable by every team: fictional names and addresses only.

**The proposal (D28).** `send_money` creates a payment in state `proposed`: `{ paymentId, planId, payer, payee, amount, reason, note?, breakdown, calls, receipt?, proof, status }`, kept on the room (`Room.proposals`, jsonb, cleared by Reset). No withdrawal, no thread, no message to the friend. The `breakdown` is 1 to 8 lines `{ label, amount, source }`; the lines **add up to the amount** (zod refine, and the tool refuses with the two sums) and a deduction is a negative line. A `source` is the id of a tool call this turn has finished (`read_receipt` returns its own `callId` so the model can cite it), the word `note` (only when the person said something), or the word `estimate` (the Muse's own number, labeled so); anything else is refused with a list of the lines at fault. The proposal runs the same checks as always (scope, cap, balance, a confirmed plan), holds at most one open proposal per plan and payer, and scans its reason and line labels like a note (proposals are readable by both phones).

Statuses: `proposed` (waiting on the person), `confirming` (mid-send), `confirmed` (sent; the payment message and the ledger are the record from here), `declined`, `failed` (a confirm that did not go through; retryable, with the reason).

**Confirm and decline** (the person, side `a` or `b`, only for their own payment; both idempotent):

| Route | What it does |
|---|---|
| `POST /api/payments/[id]/confirm { role }` | re-checks the plan, the cap (counting what is already out) and the balance; withdraws from the payer's account; sends the `payment` message (with the breakdown and the proposing turn's `proof.toolCalls`) to the friend's inbox, whose Muse accepts or sends it back; the ledger moves. A failed delivery puts the money back and leaves the proposal `failed`. A second confirm answers `already: true` and moves nothing. 403 for the other side, 404 unknown, 409 declined or mid-send |
| `POST /api/payments/[id]/decline { role }` | records the decision, writes `payment_cancelled`, and tells the friend's Muse with a `payment_cancelled` message; nothing moves. A second decline answers `already: true`. 409 once confirmed (the friend's Muse decides that one) |

The friend's inbox refuses a `payment` that has no confirmed or confirming proposal behind it, so the confirm cannot be skipped by sending the message.

**Tools** (offered only in payment turns, never in the negotiation turns):

| Tool | Who | What the runtime does |
|---|---|---|
| `get_wallet` | either | reads the balance from the ledger; shows the cap and what is already sent for the plan |
| `read_receipt({ receipt? })` | payer | returns the seeded receipt for the plan's place (`lib/seed/receipts.ts`: Shawarma Point, two plates, tax, tip, who paid), labeled seeded and fictional in its data and in the `receipt_read` Activity row, with its own `callId` |
| `send_money({ to, amount, reason, note?, breakdown })` | payer | prepares a proposal as above; nothing moves |
| `accept_payment({ paymentId })` | receiver | deposits into the receiver's account, reads the balance back, sends `payment_received` with the balance delta |
| `decline_payment({ paymentId, reason? })` | receiver | the withdrawal already happened, so it deposits the amount back into the payer's account (a refund) and sends `payment_received` with outcome `declined` |

The amount, the reason and the breakdown are the model's, from the plan, the receipt, the person's note, and who offered what; nothing in the code names one. A settle turn starts when a person taps (`POST /api/plans/[id]/settle { role, note? }`, which takes a run slot from the hourly caps); a payment arriving in an inbox starts the receiver's payment turn. A model that cannot answer a payment is replaced by a code `accept` marked as a fallback; a model that is down prepares nothing.

**Messages.** Three payment types, `payment`, `payment_received` and `payment_cancelled`, on a payment thread of their own (`contextId` `pay_<paymentId>`, linked to the plan by `planId`; `payment` then `payment_received` ends `completed`; a lone `payment_cancelled` ends `rejected`). They carry a `payment` object, and only they do:

```ts
type Payment = {
  paymentId: string; planId: string; amount: number /* whole USD, 1 to 500 */; currency: "USD";
  reason: string;                        // max 100 characters, scanned like a note
  source: "nessie" | "local";            // which ledger moved the money
  payerAccountId: string; withdrawalId?: string;                     // payment
  outcome?: "accepted" | "declined"; payeeAccountId?: string; depositId?: string;   // payment_received (depositId is the refund id when declined)
  balanceBefore?: number; balanceAfter?: number;                     // the receiver's, when accepted
  breakdown?: Array<{ label: string; amount: number; source: string }>;   // lines add up to the amount
};
```

`reason` is `settle_up`. A payment never changes a plan: no transition, no card, no windows ledger. `send_to_friend_agent` cannot author these types.

**Privacy and limits.** `SharePolicy.payments?: { enabled: boolean; capPerPlan: number }` is the payments scope: off by default, no tier turns it on, set by the owner (`POST /api/controls { type: "payments", side, enabled, cap }`). The cap counts dollars sent for a plan and still held by the friend; a refunded payment frees it; it is the upper limit, and it is enforced when the payment is prepared, again when the person confirms, and again in the receiver's inbox, which also checks that the plan exists and is confirmed or later, that the payer account is the sender's own wallet, that the payment id is new and has a confirmed proposal, that an answer comes from the person paid, and that the amount matches. Only account ids this app created are ever acted on. `enforceSharePolicy` scans `payment.reason` and `note` like any text, and the inbox rejects a message that would have been rewritten.

**Timeline and snapshot.** Activity rows `payment_proposed`, `payment_sent`, `payment_received`, `payment_declined`, `payment_cancelled`, `payment_failed` and `receipt_read` carry the ledger and the Nessie ids; a ledger error reads "Payment failed, sandbox error: ..." and never drops a plan or fails a Reset. The UI snapshot adds `wallets`, `payments`, `paymentsScope` and `sandbox` (payments are not in `messages`). Each `payments` entry has `status` (`proposed`, `declined`, `failed`, `sent`, `received`, `refunded`), `breakdown` (label, amount, `source`, `sourceKind` of `tool`, `note` or `estimate`, and the `tool` name a tool source points at), `explanation` (the lines as a sentence, for "Why $16?"), `receipt` (`{ seeded: true, place, total }`), `confirmUrl` and `declineUrl` while it waits on the person, `error` after a failed confirm, the Nessie ids (`withdrawalId`, `depositId`) after sending, and `toolCalls` (the same list as the proof on the message).

## Group of three and the trip (D20, D30)

**The group.** A star topology on the same protocol. The coordinator's Muse (Sprout, `aaron`) opens one ordinary pair thread with each other member (Mochi, `lisa`, and Pebble, `kai`); every pair thread carries the plan's `groupId`. Code intersects every member's windows, so the model chooses among windows it was given and cannot invent one. `Plan.group` holds the members, the context of each pair thread and each member's own answer; the two phone seats are mirrored into `Plan.decisions`, so everything that reads that keeps working. Members only talk to the coordinator, each pair keeps its own share policy, and every pair thread is capped at 6 messages as ever. `POST /api/signals { scenario: "group" }` starts one; Pebble's person (Kai) has no phone, so the coordinator's phone carries their card, or a model plays them (below).

**People played by a model.** When one judge plays alone (the simulated-friend switch), a model plays Michelle (Mochi's person, `POST /api/simulated-friend`) and Kai (Pebble's person, `POST /api/simulated-member`): the same shape, one real model call each, the same live-run caps, a 409 when the room has real people, a 502 and no decision when the model does not answer. The UI labels them "played by a model".

**The trip (`Plan.kind: "trip"`).** A long-horizon plan for three, months out (seed: July 2027). The wire messages are the audit trail; `Plan.trip` is the state the thread renders. Four more message types on a thread of their own per member, like payments: `trip_ask` (the coordinator asks a member's Muse one bounded question about flights and for one taste), `trip_answer` (the member's Muse relays its person's answer), `trip_plan` (the flight cap, the itinerary lines and the pot deposit), `trip_reply` (the person is in, with the deposit they confirmed, or out). They carry a strict `trip` payload; both ends validate (`lib/agent/trip-rules.ts`):

- The numbers are the people's and the seed's, never a model's. A `trip_answer` must equal the answer already recorded for that person (the inbox rejects a different number), the cap must equal the lowest recorded limit, the lines must be seeded catalog ids whose prices add to the stated total, and a `trip_reply` of "in" must name a deposit that is confirmed on the ledger.
- The bounded question is "Is $800 to $1,000 for flights okay?": yes (the top of the range), no (the bottom) or the person's own limit in whole dollars. A person played by a model never answers above their seeded ceiling, and a model that does not answer is replaced by the seeded profile, which the answer says (`by: "seed"`); the same goes for a model-played person's join, so a flaky model cannot stall a trip.
- The itinerary is the coordinator's model pick over the seeded catalog (`lib/seed/trip.ts`): one flight, one stay, two excursions. Code checks it (the flight within the cap, only low-effort items when anyone has a mobility limit, a line for Michelle's and Kai's tastes) and sends the model a plain sentence to repair a refused pick. If the model does not answer, a code-built pick stands in, labeled `fallback`. If no flight fits, the trip is dropped and says so.
- Nothing is booked and no price is real. Every line is labeled "Seeded for the demo", and the coordinator states what it does not know (`TripState.unknowns`) instead of inventing it.
- The pot (D28's pattern, built for the trip): each person has a seeded trip wallet and the pot has an account on the demo's local ledger, paper dollars, never the shared Nessie sandbox, so the Sprout and Mochi wallets and the payments cap are untouched. The proposal is 25 percent of the itinerary total per person, rounded to the nearest $10, with a breakdown whose every line names its source. Money moves only when that person confirms (`POST /api/trip/join`, a two-tap confirm in the thread), from their own wallet into the pot, with the ledger ids recorded; a failed deposit refunds. A "no" moves nothing, drops the plan for all three through the same lifecycle as any plan, and every deposit already in goes back (`refundPot`). The lifecycle refuses a trip "yes" with no confirmed deposit behind it, so no route can join a trip without the pot.
- Who acts: the judge answers and joins from cards (`POST /api/trip/answer`, `/join`); the people a model plays answer and join on their own through `driveTrip` (`lib/agent/trip.ts`), which runs after the request returns and is idempotent. With a real second phone, that person's cards are on their own phone, and Kai's are on the coordinator's.

**The thread (D30, D32).** `lib/ui/group.ts` builds one group thread from the trip and its messages; both phones read the same thread, reoriented ("your Muse" for the reader's own, an owner on every other Muse line, a "simulated" tag on every person a model plays, whose tap says so). The decisions are cards (`components/GroupThread.tsx`, `QuestionCard.tsx`): the bounded question, the budget with every row's source, the checked outline with each line's source, "Not settled yet", and the pot with a confirm that shows the breakdown. The header shows the three Muses and the group's name; Pebble has his own renders. `POST /api/signals { scenario: "trip" }`, the start card on a phone and Demo controls (T) start one.

**The recording.** `pnpm demo:record:trip` runs the trip on the live model in process (Michelle and Kai played by it, the coordinator composing, the judge answering and joining), keeps the best attempt, and writes `lib/seed/trip-run.json` with the model's name. Replay cuts it by time (`lib/ui/replay-trip.ts`: answers, cap, outline, pot, each deposit and the ledger balances), serves it at `/api/replay?scenario=trip`, and the badge reads "Replay of a real run, recorded <date>, <model>". Demo controls has Replay the recorded trip (Y).

`pnpm demo:group -- --kind trip` drives it over HTTP against a running app. Measured on live Muse Spark with the JSON store: 19 seconds from the group chat to a confirmed trip, three people, a four-line outline at $1,665 per person with the flight at $860 against a $900 cap, a $420 deposit each.

## Demo controls

- **Inject signal:** loads the seeded "Lisa sent Aaron a reel" event.
- **Fast-forward:** jumps the demo clock to the reminder, then to the next day.
- **Privacy toggle:** on Lisa's phone settings, flip location for Aaron off.
- **Replay:** plays back the committed recording of a real run (`lib/seed/live-run.json`, written by `pnpm demo:record` from a run on the live model, with each message's model proof and tool calls) for a no-network fallback, labeled with the date it was recorded. A hand-written script plays only if that file cannot be read or any of its messages lacks model proof, and it says it is scripted.
- **Payments:** a cap per plan for each person's Muse (off by default), and a settle-up tap on a confirmed plan.

## Testing

- Unit (vitest): `plans.ts` transitions, `enforceSharePolicy`, and zod schema round trips.
- Scripted run: `pnpm demo:run` drives the full scenario headless and asserts that the plan reaches `followed_up`. Run it before every demo.

Smoke tests, in this order, once `MODEL_API_KEY` is set (test 6 needs no key and can run in parallel):

1. **Billing and latency.** `POST https://api.meta.ai/v1/responses` with `Authorization: Bearer $MODEL_API_KEY` and `{"model":"muse-spark-1.3","input":"ping","reasoning":{"effort":"low"}}`. Pass: `200` with text; record the seconds. A `402 billing_not_configured` blocks everything after it.
2. **Tool loop.** Declare `get_my_calendar`, return a `function_call_output`, and make the follow-up call stateless (`store: false`, reasoning items replayed), resending `instructions`, `tools`, and the effort. Pass: parseable JSON arguments, and final text on the second call in about a second. Measured Oct 24: stateless median 1.3 seconds for the two-call turn; the `previous_response_id` chain median 11.0 seconds.
3. **Message as tool arguments.** Declare `send_to_friend_agent` with the message schema and run it 10 times. Pass: the model calls the tool every time and zod parses the arguments (or repairs them in one re-prompt). Try `text.format` plus tools once; the design does not depend on it. `zodTextFormat` is unverified; the fallback is `z.toJSONSchema`.
4. **Inbox end to end.** Two agents, the seeded scenario from the PRD. Pass: the inbox answers `202` before the model returns; the thread reaches `awaiting_humans` in 4 messages; no `504`.
5. **Privacy gate.** Seed a private event title and a location-off category. Pass: no private string in any delivered message; the redaction is logged; an invented window is dropped.
6. **Handoff.** `curl -i` the `.ics` route, then open both links on a real Mac and iPhone. Pass: `text/calendar; charset=utf-8` and `DTSTART:20261027T230000Z`; the `wa.me` link shows a contact picker with the text prefilled; the event is added to the calendar.

## Build order

1. `model.ts` + one agent calling `get_my_calendar` (proves the key and tool calling).
2. `protocol.ts`, `policy.ts`, `plans.ts` with tests.
3. Inbox routes + the two-agent negotiation in a script.
4. `/api/state` + Inspector, then the phones and cards.
5. Handoff, calendar, clock, privacy toggle.
6. Replay mode, polish.
