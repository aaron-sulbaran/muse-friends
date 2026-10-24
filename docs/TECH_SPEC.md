# Muse Friends: technical spec

Status: draft v1, Sat Oct 24, 2026. Product requirements are in [PRD.md](PRD.md); requirement ids (R1 and so on) refer to it.

## Stack

| Layer | Choice |
|---|---|
| App | Next.js (App Router), TypeScript strict, Tailwind |
| Agents | OpenAI SDK with `baseURL: "https://api.meta.ai/v1"`, model `muse-spark-1.3`, tool calling, JSON schema output |
| Validation | zod (schemas double as the JSON schema for structured output) |
| State | `Store` interface; in-memory implementation persisted to `data/store.json` |
| Live UI | Polling `/api/state` every second |
| Handoff | `https://wa.me/?text=<draft>` click-to-chat, `.ics` file for the calendar hold |
| Package manager | pnpm |

Env: `MODEL_API_KEY` (Meta Model API). Optional: `MODEL_BASE_URL` and `MODEL_ID` to swap providers without code changes.

## Layout

```
app/
├── page.tsx                    demo: two phones + agent channel inspector + demo controls
├── api/agents/[id]/inbox/      POST: deliver an AgentMessage to an agent; runs that agent's turn
├── api/signals/                POST: inject a seeded signal (e.g. "Lisa sent Aaron a reel")
├── api/plans/[id]/decision/    POST: a human accepts or declines a recommendation
├── api/clock/                  POST: demo clock fast-forward
└── api/state/                  GET: threads, messages, plans, cards, for the UI
lib/
├── protocol.ts                 zod schemas: AgentMessage, Plan, Recommendation, SharePolicy
├── agent/runtime.ts            one agent turn: context + inbox + thread history -> Muse Spark -> tool calls
├── agent/tools.ts              tool definitions and handlers
├── agent/prompts.ts            system prompt per agent
├── policy.ts                   enforceSharePolicy(): strips disallowed categories, records redactions
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

Every agent-to-agent message is one of five types, validated with zod on send and on receipt.

```ts
type AgentMessage = {
  id: string;
  threadId: string;
  from: AgentId;            // "aaron" | "lisa"
  to: AgentId;
  type: "intent" | "propose" | "counter" | "accept" | "decline";
  activity?: { kind: Category; title: string; place?: string };
  windows?: Array<{ start: string; end: string }>;   // ISO, Central
  rationale: string;        // shareable reason, human-readable
  shared: Partial<Record<Category, unknown>>;        // only what policy allows
  at: string;
};

type Category = "food" | "events" | "availability" | "location" | "interests";
```

A thread ends on `accept` from both sides, on `decline`, or at **8 messages** (marked `dropped`, with a reason).

## Agents (R1, R2)

Each agent is a separate Muse Spark loop. An agent turn gets:

- its system prompt (who it serves, the rules: never invent availability, ask the human before committing, keep turns short)
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

The runtime caps tool calls per turn at 6 and uses low temperature. Structured output uses the `AgentMessage` JSON schema.

## Privacy (R4, R9)

```ts
type SharePolicy = { friend: AgentId; tier: "close" | "friend" | "off"; categories: Partial<Record<Category, boolean>> };
```

`enforceSharePolicy(message, policy)` runs inside `send_to_friend_agent`, in code, after the model has written the message. It removes `shared` keys for categories that are off, blanks `activity.place` when location is off, and appends a `Redaction` record (`{ messageId, removed: Category[] }`) that the inspector shows. Default for a new friend is `off`: nothing is shared until the user opts in.

## Plan lifecycle (R7, R8)

```
detected -> negotiating -> awaiting_humans -> confirmed -> scheduled -> reminded -> happened -> followed_up
                     \-> dropped        \-> dropped (a human declined)
```

`plans.ts` holds the transition table as a pure function. Invalid transitions throw, and are unit tested.

- `confirmed`: both humans accepted. The draft goes to WhatsApp via `wa.me`.
- `scheduled`: the `.ics` is generated and the plan has a time.
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

## Build order

1. `model.ts` + one agent calling `get_my_calendar` (proves the key and tool calling).
2. `protocol.ts`, `policy.ts`, `plans.ts` with tests.
3. Inbox routes + the two-agent negotiation in a script.
4. `/api/state` + Inspector, then the phones and cards.
5. Handoff, calendar, clock, privacy toggle.
6. Replay mode, polish.
