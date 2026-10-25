<p align="center">
  <img src="public/wordmark/muse-friends-wordmark.svg" alt="Muse Friends" width="380">
</p>

<p align="center"><strong>Plans that make it out of the group chat.</strong></p>

Muse Friends is a feature we are proposing for Muse, Meta's personal AI agent: your Muse and your friend's Muse work out the when and where, then hand each of you one simple question.

## The dead reel

A friend sends you a reel of a place, you reply "we should go!", and nothing ever happens. Nobody wants to be the one who checks calendars and follows up. The wanting was real; the coordinating killed it.

## What it does

1. Your friend sends the reel. Your Muse reads the caption and sees a place worth a plan.
2. Your Muse and your friend's Muse compare notes. Each sees only its own person's calendar and sharing rules.
3. They settle on a time, and each of you gets one card: "You and Lisa both want to try this place, and you're both free Tuesday 6 to 8. Reach out?"
4. You say yes. Muse drafts the message and opens WhatsApp; you press send. The agents draft, the human sends.
5. The plan lives on: a calendar hold, a reminder on the day, and "again next month?" afterward.

Privacy is yours to set, friend by friend, like Close Friends on Instagram. Nothing is shared until you turn it on, and code enforces it. We count hangouts that happen between people, not messages between agents.

## See it

Live now at https://musefriends.tech (also https://muse-friends.vercel.app).

<img src="public/qr.svg" alt="QR code for the live demo" width="140">

Scan the code and tap through it in about 90 seconds. Two people can each open a side: `/a` is Sprout (Aaron's Muse), `/b` is Mochi (Lisa's).

1. Send the shawarma reel from Mochi's side. On your own, tap "Play with a simulated friend" and Michelle sends it.
2. Open Activity. The two Muses trade offers and agree in about 15 seconds, and every message shows what privacy let through.
3. Tap "Reach out". Muse opens WhatsApp with a draft; you send it.
4. Open Goals for the plan and its calendar hold, then jump the clock to the reminder and follow-up.
5. Open an avatar and turn location sharing off. The place drops out of what the other side sees, and Activity logs the removal.

## How it works

Two separate Muse Spark agents, one per person, each given only that person's calendar, interests, and sharing rules. They talk over real HTTP in structured messages (an offer, a counter, a yes) rather than free chat. A policy gate in our code checks every message against what its sender agreed to share, and the receiver checks again. Candidate times come from both calendars by code, so the model cannot invent a free evening. Once they agree, the plan is tracked from first signal to follow-up. Details: [PRD](docs/PRD.md) and [technical spec](docs/TECH_SPEC.md).

## What is real and what is seeded

| Real | Seeded or simulated |
|---|---|
| Two Muse Spark agents negotiating over real HTTP | People, calendars, and friendship: fictional, with personas named Aaron and Lisa (teammates who consented) |
| The place and time, read from the caption by the model, live | The reel itself: fictional |
| The sharing gate on every message | Michelle: a fictional friend played by a model, labeled on screen |
| The WhatsApp draft and calendar file | The clock for reminders, labeled as simulated |
| Replay: a recording of a real run, labeled "Replay" | The Muse-style screens: our recreation, not the Muse app |

## What we built versus what we used

**Ours, written during the hacking period:** the agent loop, message protocol, sharing gate, plan lifecycle, seed story, Replay, screens, avatars, wordmark, and tests.

**Used, not ours:** Next.js and React, Tailwind CSS, zod, the OpenAI SDK (pointed at Meta's endpoint), Supabase, Vercel, lucide icons, Vitest, and the Meta Model API serving Muse Spark. We also used Claude Code as a coding assistant.

## Run it yourself

```bash
pnpm install
cp .env.example .env    # then set MODEL_API_KEY (a Meta Model API key, dev.meta.ai)
pnpm dev                # open http://localhost:3000
pnpm demo:run           # the whole scenario, headless, on live Muse Spark
pnpm test               # unit tests, no key needed
```

## Team

Aaron Sulbaran ([aaron-sulbaran](https://github.com/aaron-sulbaran)) and Lisa ([lisahadi](https://github.com/lisahadi)), at HackTX 2026 for the Meta track.

Muse Friends is a feature proposal from two developers, not a Meta product. It has not shipped, and Meta has not reviewed or endorsed it.
