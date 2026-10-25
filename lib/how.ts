/**
 * The words and recorded facts on /how (D23). One static page, cut from the README and the technical spec: nothing here
 * is read from the store or written by a model, and every sentence says what main does today. Kept in one file so a test
 * can hold the rules (no em dashes, no emoji, no claim of shipping) and so a sentence is changed in one place.
 */
import type { MessageType } from "./protocol";
import { THREAD_CAP } from "./protocol";

export const HOW_PATH = "/how";
export const REPO_URL = "https://github.com/aaron-sulbaran/muse-friends";
export const README_URL = `${REPO_URL}#readme`;

export const howCopy = {
  back: "Back to the demo",
  title: "How Muse Friends works",
  subtitle: "A proposal for Muse, built at HackTX 2026",
  footer: "Muse Friends is a proposal for Muse, built at HackTX 2026. It is not a Meta product.",
  seeItLive: "See it live",
  readme: "The full details are in the README",
  /** The link inside the JSON drawer that lands on the protocol section. */
  drawerLink: "How the protocol works",
} as const;

/** Anchors, so the JSON drawer and the README can link straight to a section. */
export const HOW_ANCHORS = { loop: "loop", real: "real", privacy: "privacy", protocol: "protocol", muse: "muse", built: "built" } as const;

export const loopCopy = {
  heading: "The loop",
  lines: [
    "Two separate Muse Spark agents, one per person, each given only that person's calendar, interests, and sharing rules. They talk over real HTTP in structured messages (an offer, a counter, a yes) rather than free chat. Once they agree, each person gets one card, and the people still send the message.",
    "Each agent reads its own person's data through tools and never the other agent's. That boundary is the point.",
    "In a group of three, one Muse coordinates: it opens a thread with each other Muse, and code finds the windows all three share.",
  ],
  diagram: {
    you: "Your calendar and sharing rules",
    friend: "Your friend's calendar and sharing rules",
    gate: "Sharing gate",
    chips: ["offer", "counter", "yes"],
    youDecide: "You decide",
    friendDecides: "Your friend decides",
    send: "You send the message",
    channel: "WhatsApp",
  },
} as const;

/** The README's table, with Kai and the receipt added: both are true of main and both are seeded or played. */
export const realCopy = {
  heading: "What is real and what is seeded",
  columns: ["Real", "Seeded or simulated"],
  rows: [
    ["Two Muse Spark agents negotiating over real HTTP", "People, calendars, and friendship: fictional. You are Sprout, your friend's Muse is Mochi, and the friend is Michelle"],
    [
      "The place and time, read from the caption by the model, live",
      "The reel: seeded and fictional by default. Once an Instagram token is set it is a teammate's own reel, read live through the Instagram API with Instagram Login, and Activity says which one a run used",
    ],
    ["The sharing gate on every message", "Michelle: a fictional friend played by a model, labeled on screen. In a group of three, Kai is played by a model the same way"],
    ["The WhatsApp draft and calendar file", "The clock for reminders, labeled as simulated"],
    [
      "Transfers written to Capital One's Nessie sandbox through its real API",
      "The money: paper dollars, fictional customers, and the balance on screen is our own ledger. The receipt a payment is split from is a seeded sample, labeled seeded",
    ],
    [
      "The numbers in a group trip: the cap, the totals, and each deposit are the people's answers and the ledger, never a model's",
      "The trip catalog: flights, a stay, and excursions are seeded and labeled. Nothing is booked and no price is real",
    ],
    ["Replay: a recording of a real run, labeled \"Replay\"", "The Muse-style screens: our recreation, not the Muse app"],
  ],
} as const;

/** From the recorded run in lib/seed/live-run.json (the privacy beat): pasted, not invented, and no "before" draft is made up. */
export const privacyCopy = {
  heading: "Privacy in code",
  lines: [
    "A policy gate in our code checks every message against what its sender agreed to share, and the receiver checks again. Candidate times come from both calendars by code, so the model cannot invent a free evening. Turn your friend's location off on the stage and the next message shows it withheld.",
    "A second phone asks for the state with role=b and gets it without the first person's private chat with their own Muse. Notes from your Muse to you, such as what it kept out of a message, sit in your thread marked Only you see this and never reach your friend's phone.",
  ],
  panels: [
    {
      label: "The sharing rule Mochi's person set for Sprout's person",
      json: {
        owner: "lisa",
        friend: "aaron",
        tier: "close",
        categories: { food: true, events: true, availability: true, location: false, interests: true },
      },
      caption: "Location is off. The ids are the protocol's own: aaron is Sprout's side, lisa is Mochi's.",
    },
    {
      label: "What Mochi sent",
      json: {
        type: "accept",
        windows: [{ start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" }],
        note: "That shawarma sounds great, see you then!",
      },
      caption: "There is no shared field: the location was removed before delivery.",
    },
    {
      label: "What the gate removed",
      json: {
        id: "red_mvnkihyck05m",
        messageId: "msg_mvnkif19wk41",
        removed: ["location"],
        detail: "Policy for Mochi: the place and any location details were removed (replayed under the new setting).",
      },
      caption: "Recorded from a run where location was switched off and the message was replayed.",
    },
  ],
} as const;

const NEGOTIATION: ReadonlyArray<MessageType> = ["intent", "propose", "counter", "accept", "decline"];

export const protocolCopy = {
  heading: "The protocol",
  lines: [
    "Every negotiating message is one of five types, checked on send and on receipt. Payments and the group trip add a few more types on threads of their own, written by the runtime and checked the same way.",
    "The vocabulary is borrowed from agent-to-agent conventions (a thread, a task state) without an SDK. A thread that reaches six messages without agreement is dropped, so two agents cannot loop forever.",
  ],
  chips: NEGOTIATION,
  cap: `At most ${THREAD_CAP} messages a thread`,
  model: "Model: Muse Spark on the Meta Model API (muse-spark-1.3 by default)",
} as const;

export type MusePattern = { principle: string; ours: string; line: string; image: string | null; alt: string };

export const museCopy = {
  heading: "Designed as a Muse feature",
  intro: "Every piece of Muse Friends lands on something Muse already has. These are patterns we saw in Muse and used; the screens are our recreation, not the Muse app.",
  patterns: [
    {
      principle: "Approval cards for anything hard to undo",
      ours: "The plan card, with Not now and Reach out",
      line: "Agents recommend; people decide.",
      image: "/how/plan-card.webp",
      alt: "The plan card: Sprout wants to make a plan with Michelle, with Not now and Reach out buttons",
    },
    {
      principle: "A status line under the avatar, and an activity log you can open",
      ours: "The header avatar with its status line, and one Activity row",
      line: "You can always see what your Muse is doing, and with whom.",
      image: "/how/activity.webp",
      alt: "The Muse avatar with its status line, and an Activity row showing a message between the two Muses",
    },
    {
      principle: "Goals and Tracking for long-running work",
      ours: "The Goals tab, with the plan under Tracking",
      line: "The plan has a life after the chat: a calendar hold, a reminder, then a follow-up.",
      image: "/how/goals.webp",
      alt: "The Goals tab with the plan under Tracking",
    },
    {
      principle: "Your Muse is yours: its look and its name",
      ours: "Sprout and Mochi side by side",
      line: "Two people, two Muses, each on its own side.",
      image: null,
      alt: "Sprout and Mochi, the two Muses",
    },
  ] satisfies MusePattern[],
} as const;

export const builtCopy = {
  heading: "What we built versus what we used",
  paragraphs: [
    { lead: "Ours, written during the hacking period:", text: "the agent loop, message protocol, sharing gate, plan lifecycle, seed story, Replay, screens, avatars, wordmark, and tests." },
    {
      lead: "Used, not ours:",
      text: "Next.js and React, Tailwind CSS, zod, the OpenAI SDK (pointed at Meta's endpoint), Supabase, Vercel, lucide icons, Vitest, and the Meta Model API serving Muse Spark. The MCP SDK (@modelcontextprotocol/server and mcp-handler) is a library we call; the connector server built on it is ours. Muse itself, the app a judge may connect to our server, is Meta's client: we did not build or change it. We also used Claude Code as a coding assistant.",
    },
  ],
} as const;
