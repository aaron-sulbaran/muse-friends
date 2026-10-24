# Muse Friends: PRD

Status: v1, Sat Oct 24, 2026. HackTX 2026, Meta track ("Bringing People Closer Together with AI"). Written as the Muse team would write a feature proposal.

## Problem

"We should do this" is one of the most common things friends say and one of the least followed through. The intent is there; coordination kills it. Who's free? Does the other person still want to? Who texts first? Who follows up?

Muse already knows a lot about its user. What it can't do today is talk to the people in that user's life. Coordination between two people is still two humans and a group chat.

## Proposal

**Muse Friends** lets your Muse agent coordinate with your friends' Muse agents, with your permission, so plans you both want actually happen. The agents do the coordinating; the people do the talking.

## Users and scenario

Two friends, Aaron and Lisa, each with Muse. Lisa sends Aaron a reel of a shawarma place. Today it gets a "we should go!" and dies there.

With Muse Friends:

1. Aaron's agent notices the reel and checks with Lisa's agent: is she interested, and when is she free?
2. The agents agree on Tuesday evening. Each sees only its own human's calendar and whatever the other side's sharing settings allow.
3. Both get one card: "You and Lisa both want to try Shawarma Point. You're both free Tuesday 6 to 8. Reach out?"
4. Aaron taps yes. Muse drafts the message and opens WhatsApp; Aaron hits send. Lisa confirms.
5. The agents add a calendar hold, remind both of them on the day, and the next day ask whether to make it a regular thing.

## Goals

- **Agent to agent, for real.** Two independent agents negotiating in structured messages over a real channel, visible on screen.
- **One decision per human.** The agents absorb the back-and-forth; each person sees one recommendation.
- **Humans still talk to humans.** The agent drafts; the person sends, in the app they already use.
- **Plans get carried through.** Each plan is a tracked thread from first signal to follow-up.
- **Privacy you can see working.** Opt-in tiers and per-category sharing, enforced in code, changing what one agent can tell another.

## Non-goals (this version)

- Talking to strangers, match scores, or anything dating-adjacent
- Sending messages on the user's behalf without them pressing send
- Real ingestion of Instagram, Gmail, or calendars (seeded data stands in)
- Payments and bill splitting

## Requirements

| # | Requirement | Priority |
|---|---|---|
| R1 | Each user has their own agent with private context (calendar, interests by category, recent signals) | Must |
| R2 | An agent can detect a plan-worthy signal and open a thread with a friend's agent | Must |
| R3 | Agents exchange structured messages (intent, propose, counter, accept, decline) until agreement or a turn cap | Must |
| R4 | Every outbound agent message passes the sender's sharing policy for that friend; redactions are recorded | Must |
| R5 | On agreement, each agent surfaces one recommendation card to its human, who can accept or decline | Must |
| R6 | On accept, the agent drafts a message and hands off to WhatsApp with the draft prefilled | Must |
| R7 | Each plan has a lifecycle (detected, negotiating, awaiting humans, confirmed, scheduled, reminded, happened, followed up, dropped) visible to both agents | Must |
| R8 | A confirmed plan produces a calendar hold, a day-of reminder, and a next-day follow-up | Must (reminders via a demo clock) |
| R9 | Users set a tier per friend and per-category sharing, opt-in by default off | Must |
| R10 | Agent notifications delivered through WhatsApp | Should |
| R11 | Group plans across three or more agents; event discovery from shared interests | Could |

## Privacy model

- Opt-in, modeled on Close Friends and location sharing. Nothing is shared until the user turns it on for that friend.
- Tiers: close friends share more categories by default; others share less. Users can override any category.
- No inferred closeness: message frequency never upgrades a tier.
- Agents only coordinate between people who already know each other.

## Success, for the demo

- A judge sees two agents negotiate live and can point at the message where one agent's sharing policy redacted something.
- The full scenario runs end to end in under 90 seconds of video.
- Every step that claims to be AI is a real Muse Spark call; every hardcoded piece is seeded data, and we say so.

## Built with

Muse Spark (Meta Model API) for both agents. Full stack in [TECH_SPEC.md](TECH_SPEC.md).
