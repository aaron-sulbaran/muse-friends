<p align="center">
  <img src="public/brand/muse-friends-lockup.png" alt="Muse Friends, a proposal for Muse" width="520">
</p>

<p align="center"><strong>Plans that make it out of the group chat.</strong></p>

Muse Friends is a feature we are proposing for Muse, Meta's personal AI agent: your Muse and your friend's Muse work out the when and where, then hand each of you one simple question.

## The dead reel

A friend sends you a reel of a place, you reply "we should go!", and nothing ever happens. Nobody wants to be the one who checks calendars and follows up. The wanting was real; the coordinating killed it.

## What it does

1. Your friend sends the reel. Your Muse reads the caption and sees a place worth a plan.
2. Your Muse and your friend's Muse compare notes. Each sees only its own person's calendar and sharing rules.
3. They settle on a time, and each of you gets one card: "You and Michelle both want to try this place, and you're both free Tuesday 6 to 8. Reach out?"
4. You say yes. Muse drafts the message and opens WhatsApp; you press send. The agents draft, the human sends.
5. The plan lives on: a calendar hold, a reminder on the day, and "again next month?" afterward.

Privacy is yours to set, friend by friend, like Close Friends on Instagram. Nothing is shared until you turn it on, and code enforces it (the demo's seeded pair starts as close friends with sharing on, so the run has something to show). The one number we count is plans where a person tapped "We went!" afterward, never messages between agents.

## See it

Live now at https://musefriends.tech (also https://muse-friends.vercel.app).

<img src="public/qr.svg" alt="QR code for the live demo" width="140">

Scan the code and tap through it in about 90 seconds. On a phone it opens straight into your Muse, Sprout; tap Invite to bring a real friend in on a second phone. On a laptop, `/a` is Sprout and `/b` is Mochi, your friend's Muse.

1. Play alone: on a phone, Michelle, fictional and played by a model, is already your friend; finish the short onboarding and she sends the shawarma reel. On a laptop room with no friend yet, tap "Play with a simulated friend".
2. Open Activity. The two Muses trade offers and agree in about 20 seconds, and every message shows what privacy let through.
3. Tap "Reach out". Muse opens WhatsApp with a draft; you send it.
4. Open Goals for the plan and its calendar hold, then jump the clock to the reminder and follow-up.
5. Open an avatar and turn location sharing off. The place drops out of what the other side sees, and Activity logs the removal.

## Three scenarios

The same protocol serves more than the pair. One to one this week is the demo above, live on any phone. On the laptop stage (`/`), Demo controls also run a group of three, where a coordinator agent settles one window for three Muses, and a trip for three, where the Muses pick from a seeded catalog and the group settles up. A follow-up with someone you have just met starts from a contact's sheet. The group and the trip run only on the stage, not in phone rooms, and the "New in town" scenario is still locked.

## How it works

Two separate Muse Spark agents, one per person, each given only that person's calendar, interests, and sharing rules. On the stage they talk over real HTTP (in a phone room both agents run in one server process through the same checks) in structured messages (an offer, a counter, a yes) rather than free chat. A policy gate in our code checks every message against what its sender agreed to share, and the receiver checks again. Candidate times come from both calendars by code, so the model cannot invent a free evening. Once they agree, the plan is tracked from first signal to follow-up. Details: [PRD](docs/PRD.md) and [technical spec](docs/TECH_SPEC.md). The live site has the same walk-through on one page, with the recorded run's real messages: [/how](https://musefriends.tech/how).

## What is real and what is seeded

| Real | Seeded or simulated |
|---|---|
| Two Muse Spark agents negotiating over real HTTP on the stage, in one process in phone rooms | People, calendars, and friendship: fictional. You are Sprout, your friend's Muse is Mochi, and the friend is Michelle |
| The place and time, read from the caption by the model, live | The reel: seeded and fictional today. Once INSTAGRAM_ACCESS_TOKEN is set it is a teammate's own reel, read live through the Instagram API with Instagram Login, and Activity says which one a run used |
| The sharing gate on every message | Michelle: a fictional friend played by a model, labeled on screen |
| The WhatsApp draft and calendar file | The clock for reminders, labeled as simulated |
| Each settle-up written to Capital One's Nessie sandbox through its real API, as a withdrawal and a deposit | The money: paper dollars, fictional customers, and the balance on screen is our own ledger |
| Replay: a recording of a real run, labeled "Replay" | The Muse-style screens: our recreation, not the Muse app |

## What we built versus what we used

**Ours, written during the hacking period:** the agent loop, message protocol, sharing gate, plan lifecycle, seed story, Replay, screens, avatars, wordmark, and tests.

**Also ours, each with its real state today:**

- **Payments in Capital One's Nessie sandbox.** Paper dollars and fictional customers under our own key. The agents hold five money tools (`get_wallet`, `read_receipt`, `send_money`, `accept_payment`, `decline_payment`) behind a sharing setting that is off until a person turns it on with a cap per plan. The sandbox records every withdrawal and deposit but never moves its own balance field, so the Nessie records are the written transactions and the balance the wallet chip and payment cards show is our own ledger. `send_money` only prepares a payment: the Muse proposes, the person holds to confirm, and only then is anything written. Live on the deployed site and checked by our gate; nothing real moves.
- **The judge station, optional and unofficial.** A judge can bring their own Muse, either by opening a plain keyless page (`/j`) that offers six fictional times, or through our MCP and web routes. It exchanges only fixed, fictional times, never a calendar or contacts, in a room of its own that stops being served after two hours and is purged after the expo. It answers only while the team has set its shared key, so it is closed by default. Deployed; no real Muse has used it yet. It is a proposal for Muse, not a shipped or Meta-reviewed feature.
- **The installable shell.** The site has a web manifest and icons, so a phone can add it to the Home Screen. There is no offline mode and no notifications. Checked in a browser and by script, not yet on a real iPhone.
- **The cron sweep.** `/api/cron/sweep` moves plans along in real time, using the same lifecycle code as the demo clock: the reminder two hours before, the end, the next-day follow-up. It is set to run every 15 minutes (a Vercel Pro schedule), and it answers 401 without its secret. The secret is set; we have not confirmed a scheduled run in Vercel.

**Used, not ours:** Next.js and React, Tailwind CSS, zod, the OpenAI SDK (pointed at Meta's endpoint), Supabase, Vercel, lucide icons, Vitest, and the Meta Model API serving Muse Spark. The MCP SDK (`@modelcontextprotocol/server` and `mcp-handler`) is a library we call; the connector server built on it is ours. Muse itself, the app a judge may connect to our server, is Meta's client: we did not build or change it. We also used Claude Code as a coding assistant.

## Run it yourself

```bash
pnpm install
cp .env.example .env    # then set MODEL_API_KEY (a Meta Model API key, dev.meta.ai)
pnpm dev                # open http://localhost:3000
pnpm demo:run           # the whole scenario, headless, on live Muse Spark
pnpm test               # unit tests, no key needed
```

## Team

Aaron Sulbaran ([aaron-sulbaran](https://github.com/aaron-sulbaran)) and Lisa ([lisahadi](https://github.com/lisahadi)), at HackTX 2026 (Oct 24 to 25) for the Meta track. The judged submission is commit `fa3915b`; anything after it is post-event cleanup.

Muse Friends is a feature proposal from two developers, not a Meta product. It has not shipped, and Meta has not reviewed or endorsed it.
