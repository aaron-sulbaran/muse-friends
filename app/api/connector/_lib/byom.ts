import { randomBytes } from "node:crypto";
import { after } from "next/server";
import { z } from "zod";
import { CALENDAR_SET_BY_ROOM } from "@/lib/agent/calendar";
import { refundRun, reserveRun } from "@/lib/agent/caps";
import { newId, otherAgent } from "@/lib/agent/ids";
import { decide } from "@/lib/agent/lifecycle";
import { withLock } from "@/lib/agent/lock";
import { injectSignal, runInboxTurn, runSignalTurn } from "@/lib/agent/runtime";
import { localDeliver } from "@/lib/agent/wire";
import { describeWindow, toCentralIso, toMs } from "@/lib/agent/windows";
import type { AgentId, Plan, Signal, StateSnapshot, Window } from "@/lib/protocol";
import { CALENDAR_RANGE, displayName, rawShawarmaSignal } from "@/lib/seed/fixtures";
import type { Store } from "@/lib/store";
import { JsonStore } from "@/lib/store/json";
import { michelleDecides } from "@/lib/ui/friend";
import { persistingStore } from "./room-store";
import { presetWindows, SLOT_PRESET_NAMES } from "./presets";
import { defaultRoomRepo, ROOM_CAP_WINDOW_MS, ROOM_TTL_MS, RoomStorageError, type RoomRepo } from "./rooms";

// "Bring your own Muse": a judge's own Muse starts a plan, watches two agents agree on it, and answers
// as the person on Sprout's side. Everything here runs in a room of its own: a fresh in-memory Store per
// plan, saved as one document in the room repository, never the demo store and never the demo room.
// Sprout is the judge's side (role a); Mochi is the simulated friend, fictional and played by a model.
// The only things a judge's Muse can send are a preset name, a plan id and accept or decline: no free
// text, no windows of its own, nothing about the person.

const YOU: AgentId = "aaron";
const FRIEND: AgentId = "lisa";

// Caps for one room key, shared by every plan a judge starts: the model calls these runs make count
// against the same hourly run budget as the stage (lib/agent/caps.ts), under a key of their own.
const RUN_BUDGET_KEY = "byom";
const STALLED_AFTER_MS = 4 * 60 * 1000;

export type Failure = {
  ok: false;
  status: 400 | 403 | 404 | 409 | 422 | 429 | 502 | 503;
  code: string;
  message: string;
  retryAfterSeconds?: number;
};
export type Outcome<T> = { ok: true; value: T } | Failure;

function fail(status: Failure["status"], code: string, message: string, extra: Partial<Pick<Failure, "retryAfterSeconds">> = {}): Failure {
  return { ok: false, status, code, message, ...extra };
}

export type ByomDeps = {
  repo: RoomRepo;
  now: () => number;
  // Runs work after the response is sent (Next's after() in production).
  schedule: (work: () => Promise<void>) => void;
  // How the simulated friend answers her card. Defaults to the one model call the stage uses.
  mochi?: (plan: Plan) => Promise<"accept" | "decline">;
  // The agents' conversation. Defaults to the real one; tests pass a stand-in.
  negotiate?: (store: Store, input: { contextId: string; signalId: string; now: () => number }) => Promise<void>;
  maxRoomsPerHour?: number;
};

export function productionDeps(): ByomDeps {
  return {
    repo: defaultRoomRepo(),
    now: Date.now,
    schedule: (work) => {
      try {
        after(work);
      } catch (error) {
        // Outside a request scope after() is unavailable; the work still starts, but nothing keeps the
        // function alive for it once the response is sent.
        console.error("after() unavailable for a judge room", error instanceof Error ? error.message : error);
        void work();
      }
    },
  };
}

function maxRooms(deps: ByomDeps): number {
  const configured = Number(process.env.BYOM_ROOMS_PER_HOUR);
  return deps.maxRoomsPerHour ?? (Number.isInteger(configured) && configured > 0 ? configured : 10);
}

async function guarded<T>(work: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    if (error instanceof RoomStorageError) {
      console.error(error.message);
      return fail(503, "rooms_unavailable", "Bring your own Muse is not set up on this server yet. Nothing was saved.");
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const StartPlanInput = z.strictObject({
  slots: z.enum(SLOT_PRESET_NAMES, { error: `slots must be one of: ${SLOT_PRESET_NAMES.join(", ")}` }),
});
export type StartPlanInput = z.infer<typeof StartPlanInput>;

export const CheckPlanInput = z.object({ planId: z.string().min(1, "planId is required").max(64, "planId is too long") });
export const RespondInput = z.object({ planId: z.string().min(1, "planId is required").max(64, "planId is too long"), decision: z.enum(["accept", "decline"]) });

// ---------------------------------------------------------------------------
// The room
// ---------------------------------------------------------------------------

// A person is free in exactly the preset's windows and busy otherwise: one marker block says the room sets
// the whole calendar (the persona's seeded events stay out), then the gaps are busy blocks.
async function seedRoomCalendar(store: Store, agent: AgentId, windows: Window[]): Promise<void> {
  const marker = { id: `${CALENDAR_SET_BY_ROOM}_${agent}`, title: "Calendar set by the room", start: CALENDAR_RANGE.start, end: toCentralIso(toMs(CALENDAR_RANGE.start) + 60_000), private: true };
  await store.addBusy({ agent, event: marker });
  const gaps: Window[] = [];
  let cursor = toMs(CALENDAR_RANGE.start);
  for (const window of windows) {
    if (toMs(window.start) > cursor) gaps.push({ start: toCentralIso(cursor), end: window.start });
    cursor = Math.max(cursor, toMs(window.end));
  }
  if (cursor < toMs(CALENDAR_RANGE.end)) gaps.push({ start: toCentralIso(cursor), end: CALENDAR_RANGE.end });
  for (const [index, gap] of gaps.entries()) {
    await store.addBusy({ agent, event: { id: `room_busy_${agent}_${index}`, title: "Busy", start: gap.start, end: gap.end, private: true } });
  }
}

// Always the seeded, fictional reel: nothing a judge sends can change what the agents read.
function judgeSignal(nowMs: number): Signal {
  return { ...rawShawarmaSignal(), id: newId("sig", nowMs) };
}

// Both agents in one process: Sprout reads the reel and opens, each message is committed through the same
// receive path as the HTTP inbox (validation, share policy, ledger), and the receiving agent's turn runs next.
export async function runNegotiation(store: Store, input: { contextId: string; signalId: string; now: () => number }): Promise<void> {
  const queue: AgentId[] = [];
  const deliverFrom = (sender: AgentId) =>
    localDeliver(store, sender, (accepted) => {
      if (accepted.runTurn) queue.push(otherAgent(sender));
    });
  await runSignalTurn({ store, agent: YOU, signalId: input.signalId, contextId: input.contextId, wallNow: input.now, deliver: deliverFrom(YOU) });
  for (let turns = 0; queue.length > 0 && turns < 8; turns += 1) {
    const agent = queue.shift()!;
    await runInboxTurn({ store, agent, contextId: input.contextId, wallNow: input.now, deliver: deliverFrom(agent) });
  }
}

export type StartPlanView = {
  planId: string;
  contextId: string;
  state: "negotiating";
  you: string;
  friend: string;
  slots: string;
  // Sprout's free windows for the preset, the fictional ones printed on /connect.
  free_windows: Array<{ start: string; end: string; label: string }>;
  expires_in_minutes: number;
  how_to_check: string;
};

export async function startPlan(raw: unknown, deps: ByomDeps): Promise<Outcome<StartPlanView>> {
  // Free text and windows of the person's own are refused outright, with a message that says what to send.
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const extra = Object.keys(raw).filter((key) => key !== "slots");
    if (extra.length > 0) {
      return fail(400, "bad_input", `start_plan takes only slots (${SLOT_PRESET_NAMES.join(", ")}). It does not accept ${extra.map((key) => `"${key}"`).join(", ")}: send no free text and no windows of your own, only a preset name.`);
    }
  }
  const parsed = StartPlanInput.safeParse(raw);
  if (!parsed.success) return fail(400, "bad_input", `slots is required and must be one of: ${SLOT_PRESET_NAMES.join(", ")}.`);
  const now = deps.now();
  const windows = presetWindows(parsed.data.slots, now);
  if (windows.sprout.length === 0 || windows.mochi.length === 0) {
    return fail(422, "slots_expired", "That preset's calendar has already passed. The station's fictional week is over.");
  }

  // The room: a fresh in-memory store with the simulated friend on, the clock at real now, and both calendars.
  const store = new JsonStore(null);
  const nowIso = toCentralIso(now);
  await store.putRoom({ id: "demo", simulatedFriend: true, resetCount: 0, updatedAt: nowIso });
  await store.setClock({ now: nowIso });
  await seedRoomCalendar(store, YOU, windows.sprout);
  await seedRoomCalendar(store, FRIEND, windows.mochi);

  const guard = await guarded(async () => {
    await deps.repo.purgeExpired(now);
    return deps.repo.countCreatedSince(now - ROOM_CAP_WINDOW_MS);
  });
  if (!guard.ok) return guard;
  if (guard.value >= maxRooms(deps)) {
    return fail(429, "room_cap", `This connector starts at most ${maxRooms(deps)} plans an hour across everyone. Try again in a few minutes.`, { retryAfterSeconds: 300 });
  }
  const slot = reserveRun(RUN_BUDGET_KEY, now);
  if (!slot.ok) return fail(429, "runs_paused", slot.text, { retryAfterSeconds: slot.budget.retryAfterSeconds ?? 60 });

  const signal = judgeSignal(now);
  const { contextId } = await injectSignal(store, signal, () => now);
  const roomKey = `room_${randomBytes(12).toString("base64url")}`;
  const created = await guarded(async () => deps.repo.create(roomKey, await store.snapshot(), now));
  if (!created.ok) {
    refundRun(RUN_BUDGET_KEY, now);
    return created;
  }

  const persisted = persistingStore(store, (snapshot) => deps.repo.save(roomKey, snapshot));
  const negotiate = deps.negotiate ?? runNegotiation;
  deps.schedule(async () => {
    try {
      await negotiate(persisted.store, { contextId, signalId: signal.id, now: deps.now });
    } catch (error) {
      console.error("judge room negotiation failed", error instanceof Error ? error.message : error);
    } finally {
      await persisted.flush().catch((error) => console.error("judge room final save failed", error instanceof Error ? error.message : error));
    }
  });

  return {
    ok: true,
    value: {
      planId: roomKey,
      contextId,
      state: "negotiating",
      you: displayName(YOU),
      friend: `${displayName(FRIEND)} (a fictional friend played by a model)`,
      slots: parsed.data.slots,
      free_windows: windows.sprout.map((window) => ({ ...window, label: describeWindow(window) })),
      expires_in_minutes: ROOM_TTL_MS / 60_000,
      how_to_check: `Sprout (your Muse's side) and Mochi are negotiating now. Call check_plan with planId "${roomKey}" in about 15 seconds. It says "negotiating" until they agree, then "awaiting_you" with the agreed time and a drafted message. Then ask the person, and call respond with decision "accept" or "decline".`,
    },
  };
}

// ---------------------------------------------------------------------------
// Looking at a room, and answering in it
// ---------------------------------------------------------------------------

type OpenRoom = { store: Store; flush: () => Promise<void> };

async function openRoom(deps: ByomDeps, roomKey: string): Promise<Outcome<OpenRoom>> {
  const loaded = await guarded(() => deps.repo.load(roomKey, deps.now()));
  if (!loaded.ok) return loaded;
  if (!loaded.value) return fail(404, "no_such_plan", "No plan with that planId. It may have expired: plans last 2 hours.");
  const store = new JsonStore(null);
  await store.replaceAll(loaded.value);
  const persisted = persistingStore(store, (snapshot) => deps.repo.save(roomKey, snapshot));
  return { ok: true, value: { store: persisted.store, flush: persisted.flush } };
}

export type PlanView = {
  planId: string;
  state: "negotiating" | "awaiting_you" | "waiting_for_mochi" | "confirmed" | "dropped" | "stalled";
  plan_state: Plan["state"];
  activity: { title: string; place?: string } | null;
  messages: Array<{
    seq: number;
    from: string;
    to: string;
    type: string;
    note: string | null;
    windows: Array<{ start: string; end: string; label: string }>;
    policy: { shared: string[]; withheld: string[]; windows_dropped: number };
  }>;
  agreed_window: { start: string; end: string; label: string } | null;
  decisions: { you: string; mochi: string };
  whatsapp_draft: string | null;
  whatsapp_link: string | null;
  dropped_reason: string | null;
  next: string;
};

function planView(roomKey: string, snapshot: StateSnapshot, nowMs: number): PlanView {
  const plan = snapshot.plans[0];
  const records = snapshot.messages.filter((record) => record.message.contextId === plan.contextId).sort((a, b) => a.message.seq - b.message.seq);
  const youDecided = plan.decisions[YOU];
  const friendDecided = plan.decisions[FRIEND];
  const windowLabel = (window: Window) => ({ ...window, label: describeWindow(window) });

  let state: PlanView["state"];
  let next: string;
  const ageMs = nowMs - toMs(plan.createdAt);
  if (plan.state === "dropped") {
    state = "dropped";
    next = plan.dropReason === "no_overlap" ? "They found no time that works for both. Start a new plan, with the same or another slots preset." : "This plan ended. Start a new plan if the person wants to try again.";
  } else if (plan.state === "awaiting_humans") {
    if (youDecided === "pending") {
      state = "awaiting_you";
      next = "Sprout and Mochi agreed on a time. Show the person the plan and the drafted message, then call respond with decision accept or decline.";
    } else {
      state = "waiting_for_mochi";
      next = "The person said yes. Mochi, the simulated friend, is answering her card; call check_plan again in a few seconds.";
    }
  } else if (plan.state === "detected" || plan.state === "negotiating") {
    state = ageMs > STALLED_AFTER_MS ? "stalled" : "negotiating";
    next = state === "stalled" ? "No progress for several minutes. Start a new plan." : "Sprout and Mochi are still talking. Call check_plan again in about 10 seconds.";
  } else {
    state = "confirmed";
    next = "Confirmed. Give the person the drafted message to send themselves in WhatsApp; the agents only draft and never send it, and no calendar entry is made for them.";
  }

  const draft = plan.draft && (state === "awaiting_you" || state === "waiting_for_mochi" || state === "confirmed") ? plan.draft : null;
  return {
    planId: roomKey,
    state,
    plan_state: plan.state,
    activity: plan.activity ? { title: plan.activity.title, place: plan.activity.place } : null,
    messages: records.map(({ message, stamp }) => ({
      seq: message.seq,
      from: displayName(message.from),
      to: displayName(message.to),
      type: message.type,
      note: message.note ?? null,
      windows: (message.windows ?? []).map(windowLabel),
      policy: { shared: stamp.passed, withheld: stamp.removed, windows_dropped: stamp.windowsDropped },
    })),
    agreed_window: plan.window ? windowLabel(plan.window) : null,
    decisions: { you: youDecided, mochi: friendDecided },
    whatsapp_draft: draft,
    whatsapp_link: draft ? `https://wa.me/?text=${encodeURIComponent(draft)}` : null,
    dropped_reason: plan.dropReason ?? null,
    next,
  };
}

// Mochi answers her card once the person has answered theirs: one model call, counted against the run
// budget. If that fails the card stays pending and the next check_plan tries again; a second answer from
// the same person is refused by the lifecycle, so asking twice is harmless.
async function settleMochi(deps: ByomDeps, room: OpenRoom, planId: string): Promise<void> {
  const plan = await room.store.getPlan(planId);
  if (!plan || plan.state !== "awaiting_humans" || plan.decisions[YOU] === "pending" || plan.decisions[FRIEND] !== "pending") return;
  if (!(await room.store.getRoom()).simulatedFriend) return;
  const slot = reserveRun(RUN_BUDGET_KEY, deps.now());
  if (!slot.ok) return;
  try {
    const choice = deps.mochi ? await deps.mochi(plan) : (await michelleDecides(plan)).choice;
    await decide(room.store, { planId, agent: FRIEND, choice }, { wallNow: deps.now });
  } catch (error) {
    refundRun(RUN_BUDGET_KEY, deps.now());
    console.error("the simulated friend did not answer", error instanceof Error ? error.message : error);
  }
}

export async function checkPlan(raw: unknown, deps: ByomDeps): Promise<Outcome<PlanView>> {
  const parsed = CheckPlanInput.safeParse(raw);
  if (!parsed.success) return fail(400, "bad_input", z.prettifyError(parsed.error));
  const roomKey = parsed.data.planId;
  return withLock(`byom:${roomKey}`, async () => {
    const opened = await openRoom(deps, roomKey);
    if (!opened.ok) return opened;
    const plan = (await opened.value.store.snapshot()).plans[0];
    await settleMochi(deps, opened.value, plan.id);
    const flushed = await guarded(() => opened.value.flush());
    if (!flushed.ok) return flushed;
    const snapshot = await opened.value.store.snapshot();
    return { ok: true, value: planView(roomKey, snapshot, deps.now()) } as const;
  });
}

export type RespondView = PlanView & { you_answered: "accepted" | "declined" };

export async function respond(raw: unknown, deps: ByomDeps): Promise<Outcome<RespondView>> {
  const parsed = RespondInput.safeParse(raw);
  if (!parsed.success) return fail(400, "bad_input", z.prettifyError(parsed.error));
  const roomKey = parsed.data.planId;
  return withLock(`byom:${roomKey}`, async () => {
    const opened = await openRoom(deps, roomKey);
    if (!opened.ok) return opened;
    const { store, flush } = opened.value;
    const plan = (await store.snapshot()).plans[0];
    const answered = await decide(store, { planId: plan.id, agent: YOU, choice: parsed.data.decision }, { wallNow: deps.now });
    if (!answered.ok) {
      const status = answered.status === 404 ? 404 : answered.status === 422 ? 422 : 409;
      return fail(status, status === 409 ? "not_waiting_for_you" : "bad_answer", answered.error);
    }
    if (parsed.data.decision === "accept") await settleMochi(deps, opened.value, plan.id);
    const flushed = await guarded(() => flush());
    if (!flushed.ok) return flushed;
    const snapshot = await store.snapshot();
    return { ok: true, value: { ...planView(roomKey, snapshot, deps.now()), you_answered: parsed.data.decision === "accept" ? "accepted" : "declined" } } as const;
  });
}
