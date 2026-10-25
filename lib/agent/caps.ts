// Live runs spend Muse credits, and the public URL has no login. Two rolling one-hour caps keep that bounded:
// one per room, one for the whole app. They are counted here, in memory, not in the Store, so pressing Reset
// (which wipes the Store) does not give the credits back. A paused room is meant to fall back to Replay.
//
// Limit: the count lives in one server instance. On Vercel that is usually enough for a demo; separate
// instances each keep their own count, so the true ceiling is the limit times the instances in play.

export const WINDOW_MS = 60 * 60 * 1000;
export const DEFAULT_ROOM_LIMIT = 30;
export const DEFAULT_GLOBAL_LIMIT = 60;
export const DEFAULT_CHAT_LIMIT = 20;
export const PAUSED_TEXT = "Live runs paused, playing a recording";

const GLOBAL_KEY = "*";
type Log = Map<string, number[]>;

function log(): Log {
  const holder = globalThis as typeof globalThis & { __museRunLog?: Log };
  return (holder.__museRunLog ??= new Map());
}

function limit(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 && process.env[name] !== undefined && process.env[name] !== "" ? Math.floor(parsed) : fallback;
}

export function limits(): { room: number; global: number } {
  return { room: limit("MAX_LIVE_RUNS_PER_ROOM_PER_HOUR", DEFAULT_ROOM_LIMIT), global: limit("MAX_LIVE_RUNS_PER_HOUR", DEFAULT_GLOBAL_LIMIT) };
}

function recent(key: string, now: number): number[] {
  const kept = (log().get(key) ?? []).filter((at) => at > now - WINDOW_MS);
  log().set(key, kept);
  return kept;
}

export type PauseReason = "room" | "global";

export type RunBudget = {
  windowMinutes: number;
  room: { used: number; limit: number; remaining: number };
  global: { used: number; limit: number; remaining: number };
  paused: boolean;
  reason?: PauseReason;
  // Seconds until a slot frees up, when paused.
  retryAfterSeconds?: number;
};

// The counters, for the JSON drawer and the 429 body.
export function runBudget(room = "demo", now: number = Date.now()): RunBudget {
  const max = limits();
  const roomRuns = recent(room, now);
  const globalRuns = recent(GLOBAL_KEY, now);
  const reason: PauseReason | undefined = globalRuns.length >= max.global ? "global" : roomRuns.length >= max.room ? "room" : undefined;
  const blocking = reason === "global" ? globalRuns : reason === "room" ? roomRuns : [];
  return {
    windowMinutes: WINDOW_MS / 60_000,
    room: { used: roomRuns.length, limit: max.room, remaining: Math.max(0, max.room - roomRuns.length) },
    global: { used: globalRuns.length, limit: max.global, remaining: Math.max(0, max.global - globalRuns.length) },
    paused: reason !== undefined,
    reason,
    retryAfterSeconds: blocking.length > 0 ? Math.max(1, Math.ceil((blocking[0] + WINDOW_MS - now) / 1000)) : undefined,
  };
}

// Checks both caps and, if there is room, counts the run: one synchronous step, so two taps at once
// cannot both take the last slot.
export function reserveRun(room = "demo", now: number = Date.now()): { ok: true; budget: RunBudget } | { ok: false; budget: RunBudget; reason: PauseReason; text: string } {
  const before = runBudget(room, now);
  if (before.paused) return { ok: false, budget: before, reason: before.reason!, text: PAUSED_TEXT };
  recent(room, now).push(now);
  recent(GLOBAL_KEY, now).push(now);
  return { ok: true, budget: runBudget(room, now) };
}

// Gives back a reserved run that never started anything (for example a follow-up naming an unknown contact).
export function refundRun(room = "demo", now: number = Date.now()): void {
  recent(room, now).pop();
  recent(GLOBAL_KEY, now).pop();
}

// The chat with a person's own Muse (D31) is cheaper than a run, so it has a count of its own per room, 20 an hour
// (MAX_CHAT_TURNS_PER_ROOM_PER_HOUR), and still spends from the app-wide hourly total so the whole app stays bounded.
const chatKey = (room: string) => `chat:${room}`;

export function chatLimit(): number {
  return limit("MAX_CHAT_TURNS_PER_ROOM_PER_HOUR", DEFAULT_CHAT_LIMIT);
}

export type ChatBudget = { windowMinutes: number; used: number; limit: number; remaining: number; retryAfterSeconds?: number };

export function chatBudget(room = "demo", now: number = Date.now()): ChatBudget {
  const max = chatLimit();
  const turns = recent(chatKey(room), now);
  return {
    windowMinutes: WINDOW_MS / 60_000,
    used: turns.length,
    limit: max,
    remaining: Math.max(0, max - turns.length),
    retryAfterSeconds: turns.length >= max && turns.length > 0 ? Math.max(1, Math.ceil((turns[0] + WINDOW_MS - now) / 1000)) : undefined,
  };
}

export const CHAT_PAUSED_TEXT = "That is a lot of questions for one hour. Your Muse will be back to answer in a few minutes.";

export function reserveChat(room = "demo", now: number = Date.now()): { ok: true; budget: ChatBudget } | { ok: false; budget: ChatBudget; reason: PauseReason; text: string } {
  const before = chatBudget(room, now);
  if (before.remaining <= 0) return { ok: false, budget: before, reason: "room", text: CHAT_PAUSED_TEXT };
  const global = runBudget(room, now);
  if (global.global.remaining <= 0) return { ok: false, budget: before, reason: "global", text: PAUSED_TEXT };
  recent(chatKey(room), now).push(now);
  recent(GLOBAL_KEY, now).push(now);
  return { ok: true, budget: chatBudget(room, now) };
}

// Gives back a reserved chat turn that never reached the model (a bad question, a side with no chat).
export function refundChat(room = "demo", now: number = Date.now()): void {
  recent(chatKey(room), now).pop();
  recent(GLOBAL_KEY, now).pop();
}

export function resetRunBudget(): void {
  log().clear();
}
