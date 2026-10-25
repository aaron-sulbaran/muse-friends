# Muse Friends: technical spec

Status: draft v2, Sat Oct 24, 2026, after the feasibility research. Product requirements are in [PRD.md](PRD.md); requirement ids (R1 and so on) refer to it.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js (App Router), TypeScript strict, Tailwind |
| Agents | OpenAI SDK with `baseURL: "https://api.meta.ai/v1"` and `apiKey: process.env.MODEL_API_KEY` (passed explicitly; the SDK does not read that variable), model `muse-spark-1.3`, Responses API (`client.responses.create`) with function tools. The message schema is the parameters of the `send_to_friend_agent` tool, zod-parsed on receipt |
| Validation | zod (the same schemas, converted to JSON schema, are the tool parameters) |
| State | `Store` interface; in-memory implementation persisted to `data/store.json` |
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

Every agent-to-agent message is one of five types, validated with zod on send and on receipt. The vocabulary is A2A-shaped: a thread is a `contextId`, and `state` borrows A2A v0.3 task-state names. No A2A SDK is used and the inbox does not implement the A2A methods; it is a plain HTTP inbox. The sender POSTs the message to the peer's inbox with a bearer header. The inbox validates it, persists it, answers `202` with the task state, and runs the turn after responding, so a chain of agent-to-agent calls never waits on a model call. Each agent also serves an agent card that pins A2A v0.3 field names (current A2A docs show v1.0 names, which are not used here).

```ts
type AgentMessage = {
  id: string;
  contextId: string;        // the thread
  seq: number;              // position in the thread, 1 to 6
  from: AgentId;            // "aaron" | "lisa"
  to: AgentId;
  type: "intent" | "propose" | "counter" | "accept" | "decline";
  state: "working" | "input-required" | "completed" | "rejected" | "failed";
  activity?: { kind: Category; title: string; place?: string };   // title: max 60 characters
  windows?: Array<{ start: string; end: string }>;   // free windows only; ISO, Central; max 3
  reason: "both_free" | "interest_match" | "no_overlap" | "cap_reached";
  note?: string;            // max 140 characters, scanned at send
  shared?: Partial<Record<Category, unknown>>;       // allowlist-projected, never availability
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

The runtime drives each turn with the Responses API, as one `previous_response_id` chain:

1. The first `client.responses.create` call sends the system prompt as `instructions`, the tools, `reasoning: { effort: "low" }`, and the thread history rebuilt from the Store as input.
2. For each `function_call` in the response, the runtime runs the handler and returns a `function_call_output` with the same `call_id`.
3. Every follow-up call sends only those new items plus `previous_response_id`, and resends `instructions`, `tools`, and the reasoning effort, because the chain does not carry them. A just-finished response can briefly answer a chain call with a `400` or `404`; retry after a short pause.
4. A response with no `function_call` ends the turn.

Temperature stays unset. Tool arguments are not guaranteed to validate, so every handler zod-parses its own arguments, and a failure goes back to the model as tool output so it can repair the call. The message schema is the parameters of the `send_to_friend_agent` tool (see Protocol); those parameter schemas omit `strict: true`, since optional fields cannot satisfy it, and the zod parse is the enforcement. `text.format` is not used with tools.

The runtime caps tool calls per turn at 6. Because `tool_choice` accepts only `"auto"`, the model can answer in prose instead of calling `send_to_friend_agent`. A nudge-and-retry guard covers that: when a reply has no tool call where one is expected, the runtime appends a short instruction to call the tool and makes one more call in the chain. If that call also has no tool call, the turn ends and the thread is marked `failed` with reason `cap_reached`, so the inspector shows why.

## Privacy (R4, R9)

```ts
type SharePolicy = { friend: AgentId; tier: "close" | "friend" | "off"; categories: Partial<Record<Category, boolean>> };
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

## Demo controls

- **Inject signal:** loads the seeded "Lisa sent Aaron a reel" event.
- **Fast-forward:** jumps the demo clock to the reminder, then to the next day.
- **Privacy toggle:** on Lisa's phone settings, flip location for Aaron off.
- **Replay:** plays back a recorded run from `data/` for a no-network fallback.

## Testing

- Unit (vitest): `plans.ts` transitions, `enforceSharePolicy`, and zod schema round trips.
- Scripted run: `pnpm demo:run` drives the full scenario headless and asserts that the plan reaches `followed_up`. Run it before every demo.

Smoke tests, in this order, once `MODEL_API_KEY` is set (test 6 needs no key and can run in parallel):

1. **Billing and latency.** `POST https://api.meta.ai/v1/responses` with `Authorization: Bearer $MODEL_API_KEY` and `{"model":"muse-spark-1.3","input":"ping","reasoning":{"effort":"low"}}`. Pass: `200` with text; record the seconds. A `402 billing_not_configured` blocks everything after it.
2. **Tool loop.** Declare `get_my_calendar`, return a `function_call_output`, and chain with `previous_response_id`, resending `instructions`, `tools`, and the effort. Pass: parseable JSON arguments, and final text on the second call; a brief `400` or `404` on chaining retries cleanly.
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
