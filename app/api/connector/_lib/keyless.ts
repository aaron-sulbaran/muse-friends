import { createHash, randomInt } from "node:crypto";
import { judgeKeyConfigured } from "@/app/api/mcp/_lib/auth";
import { refundRun, reserveRun } from "@/lib/agent/caps";
import { withLock } from "@/lib/agent/lock";
import { injectSignal } from "@/lib/agent/runtime";
import { intersectWindows, toCentralIso, toMs } from "@/lib/agent/windows";
import type { StateSnapshot, Window } from "@/lib/protocol";
import { JsonStore } from "@/lib/store/json";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import type { UiSnapshot } from "@/lib/ui/types";
import {
  FRIEND,
  RUN_BUDGET_KEY,
  YOU,
  checkPlan,
  fail,
  guarded,
  judgeSignal,
  maxRooms,
  productionDeps,
  respond,
  scheduleNegotiation,
  seedRoomCalendar,
  type ByomDeps,
  type Outcome,
  type PlanView,
} from "./byom";
import { CANDIDATE_MOCHI_FREE, CANDIDATE_SLOTS, candidateById, candidateLabel } from "./presets";
import { ROOM_CAP_WINDOW_MS, ROOM_TTL_MS, RoomStorageError } from "./rooms";

// The keyless path: a judge's Muse opens /j/<code> in its own browser, ticks the proposed times that suit its
// person, submits, and later presses Approve or Decline. The code stands in for the key, so everything here is
// closed unless the judge key is set. A code names one room (one plan) in the same table as the tool rooms,
// expires with it after 2 hours, and is minted under the same cap on rooms per hour. What reaches us is only
// which of six fictional boxes were ticked: the server accepts those ids and nothing else.

export { judgeKeyConfigured };

export const CODE_LENGTH = 7;
// No i, l, o, 0 or 1, so a code read aloud or off a screen is not mistaken. Lowercase letters and digits, which
// is also what the phone's ?room= parameter allows, so the table screen can open a judge's room by its code.
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_PATTERN = /^[a-hj-km-np-z2-9]{7}$/;

export function normalizeCode(raw: string | null | undefined): string | null {
  const lower = raw?.trim().toLowerCase() ?? "";
  return CODE_PATTERN.test(lower) ? lower : null;
}

export const roomKeyOfCode = (code: string) => `j_${code}`;

function randomCode(): string {
  let code = "";
  for (let index = 0; index < CODE_LENGTH; index += 1) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

const MOCHI_FREE: Window[] = [...CANDIDATE_MOCHI_FREE];
const upcoming = (windows: Window[], nowMs: number) => windows.filter((window) => toMs(window.end) > nowMs);

// The sentence a judge pastes into their own Muse, with the code filled in.
export function linkSentence(origin: string, code: string): string {
  return `Open ${origin}/j/${code}, check which proposed times I'm free for, pick the ones that work, and show me the plan before approving`;
}

export type MintedCode = { code: string; expires_in_minutes: number };

// A new, empty room under a new code: the cap on rooms per hour is counted here, so a code is the scarce thing.
export async function mintCode(deps: ByomDeps): Promise<Outcome<MintedCode>> {
  const now = deps.now();
  const guard = await guarded(async () => {
    await deps.repo.purgeExpired(now);
    return deps.repo.countCreatedSince(now - ROOM_CAP_WINDOW_MS);
  });
  if (!guard.ok) return guard;
  if (guard.value >= maxRooms(deps)) {
    return fail(429, "room_cap", `This station gives out at most ${maxRooms(deps)} links an hour across everyone. Try again in a few minutes.`, { retryAfterSeconds: 300 });
  }
  const store = new JsonStore(null);
  const nowIso = toCentralIso(now);
  await store.putRoom({ id: "demo", simulatedFriend: true, resetCount: 0, updatedAt: nowIso });
  await store.setClock({ now: nowIso });
  const snapshot = await store.snapshot();
  return guarded(async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = randomCode();
      if ((await deps.repo.lookup(roomKeyOfCode(code), now)).status !== "missing") continue;
      await deps.repo.create(roomKeyOfCode(code), snapshot, now);
      return { code, expires_in_minutes: ROOM_TTL_MS / 60_000 };
    }
    throw new RoomStorageError("create", "no free code found");
  });
}

type LiveRoom = { code: string; snapshot: StateSnapshot; expiresAt: number };

const NO_SUCH_LINK = "This link is not valid. Ask for a new one.";
const EXPIRED_LINK = "This link has expired. Links work for 2 hours; ask for a new one.";

async function liveRoom(rawCode: string, deps: ByomDeps): Promise<Outcome<LiveRoom>> {
  const code = normalizeCode(rawCode);
  if (!code) return fail(404, "no_such_code", NO_SUCH_LINK);
  const found = await guarded(() => deps.repo.lookup(roomKeyOfCode(code), deps.now()));
  if (!found.ok) return found;
  if (found.value.status === "missing") return fail(404, "no_such_code", NO_SUCH_LINK);
  if (found.value.status === "expired") return fail(410, "code_expired", EXPIRED_LINK);
  return { ok: true, value: { code, snapshot: found.value.snapshot, expiresAt: found.value.expiresAt } };
}

export type LinkView =
  | { phase: "pick"; code: string; candidates: Array<{ id: string; label: string }>; minutesLeft: number }
  | { phase: "plan"; code: string; plan: PlanView; minutesLeft: number };

const minutesLeft = (expiresAt: number, now: number) => Math.max(1, Math.ceil((expiresAt - now) / 60_000));

// What /j/<code> shows: the six times to tick until a plan is started, then the plan as it stands.
export async function viewLink(rawCode: string, deps: ByomDeps): Promise<Outcome<LinkView>> {
  const room = await liveRoom(rawCode, deps);
  if (!room.ok) return room;
  const left = minutesLeft(room.value.expiresAt, deps.now());
  if (room.value.snapshot.plans.length === 0) {
    return { ok: true, value: { phase: "pick", code: room.value.code, candidates: CANDIDATE_SLOTS.map((candidate) => ({ id: candidate.id, label: candidateLabel(candidate.window) })), minutesLeft: left } };
  }
  const plan = await checkPlan({ planId: roomKeyOfCode(room.value.code) }, deps);
  if (!plan.ok) return plan;
  return { ok: true, value: { phase: "plan", code: room.value.code, plan: plan.value, minutesLeft: left } };
}

// The ticks become Sprout's free time and the room's fixed calendar becomes Mochi's; then the two agents talk.
// Only the six known ids are accepted, at least one, and at least one must be a time Mochi can also do.
export async function startFromPicks(rawCode: string, picks: unknown, deps: ByomDeps): Promise<Outcome<{ code: string }>> {
  const ids = Array.isArray(picks) ? picks : [];
  if (ids.some((id) => typeof id !== "string" || !candidateById(id))) {
    return fail(400, "bad_input", "Tick only the boxes on this page. Anything else is refused.");
  }
  const unique = [...new Set(ids as string[])];
  if (unique.length === 0) return fail(400, "no_picks", "Tick at least one time, then press Send my picks again.");
  const now = deps.now();
  const sprout = upcoming(unique.map((id) => candidateById(id)!.window), now).sort((a, b) => toMs(a.start) - toMs(b.start));
  if (sprout.length === 0) return fail(422, "slots_expired", "Those times have already passed. The station's fictional week is over.");
  if (intersectWindows(sprout, upcoming(MOCHI_FREE, now)).length === 0) {
    const workable = CANDIDATE_SLOTS.filter((candidate) => intersectWindows([candidate.window], upcoming(MOCHI_FREE, now)).length > 0).map((candidate) => candidateLabel(candidate.window));
    return fail(422, "no_overlap_with_mochi", `Mochi, the fictional friend, cannot do any of the times ticked. She can do: ${workable.join("; ")}. Tick at least one of those as well.`);
  }

  const room = await liveRoom(rawCode, deps);
  if (!room.ok) return room;
  const roomKey = roomKeyOfCode(room.value.code);
  return withLock(`byom:${roomKey}`, async () => {
    const fresh = await liveRoom(rawCode, deps);
    if (!fresh.ok) return fresh;
    if (fresh.value.snapshot.plans.length > 0) return fail(409, "already_started", "A plan was already started with this link. Reload the page to see it.");
    const slot = reserveRun(RUN_BUDGET_KEY, now);
    if (!slot.ok) return fail(429, "runs_paused", slot.text, { retryAfterSeconds: slot.budget.retryAfterSeconds ?? 60 });

    const store = new JsonStore(null);
    await store.replaceAll(fresh.value.snapshot);
    await seedRoomCalendar(store, YOU, sprout);
    await seedRoomCalendar(store, FRIEND, upcoming(MOCHI_FREE, now));
    const signal = judgeSignal(now);
    const { contextId } = await injectSignal(store, signal, () => now);
    const saved = await guarded(async () => deps.repo.save(roomKey, await store.snapshot()));
    if (!saved.ok) {
      refundRun(RUN_BUDGET_KEY, now);
      return saved;
    }
    scheduleNegotiation(deps, roomKey, store, contextId, signal.id);
    return { ok: true, value: { code: fresh.value.code } } as const;
  });
}

// The person's own Approve or Decline, pressed on the page; the same answer the respond tool records.
export async function answerFromPage(rawCode: string, decision: unknown, deps: ByomDeps): Promise<Outcome<PlanView>> {
  if (decision !== "accept" && decision !== "decline") return fail(400, "bad_input", "Press Approve or Decline.");
  const room = await liveRoom(rawCode, deps);
  if (!room.ok) return room;
  return respond({ planId: roomKeyOfCode(room.value.code), decision }, deps);
}

// The table screen: the stage polls /api/state?room=<code> and, for a live judge room, gets that room instead
// of the demo room. Anything that is not a live judge room returns null and the demo room answers as before.
// The ETag is a hash of the snapshot because a room read from storage has no running counter.
export async function readJudgeRoom(room: string, deps: ByomDeps = productionDeps()): Promise<{ etag: string; ui: UiSnapshot } | null> {
  if (!judgeKeyConfigured()) return null;
  const code = normalizeCode(room);
  if (!code || code !== room) return null;
  const found = await deps.repo.lookup(roomKeyOfCode(code), deps.now());
  if (found.status !== "live") return null;
  const store = new JsonStore(null);
  await store.replaceAll(found.snapshot);
  const snapshot = await store.snapshot();
  const etag = `judge-${createHash("sha1").update(JSON.stringify(snapshot)).digest("hex").slice(0, 16)}`;
  return { etag, ui: toUiSnapshot(snapshot, { mode: "live", budget: null, liveReel: null }) };
}
