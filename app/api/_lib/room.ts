import { createHash } from "node:crypto";
import { after, NextResponse } from "next/server";
import { judgeKeyConfigured, normalizeCode } from "@/app/api/connector/_lib/keyless";
import { persistingStore } from "@/app/api/connector/_lib/room-store";
import { defaultRoomRepo, ROOM_CAP_WINDOW_MS, RoomStorageError, type RoomRepo } from "@/app/api/connector/_lib/rooms";
import { otherAgent } from "@/lib/agent/ids";
import { withLock } from "@/lib/agent/lock";
import { runInboxTurn } from "@/lib/agent/runtime";
import { httpDeliver, localDeliver } from "@/lib/agent/wire";
import { toCentralIso } from "@/lib/agent/windows";
import type { AgentId, StateSnapshot, Wallet } from "@/lib/protocol";
import { DEFAULT_ROOM, seedSnapshot } from "@/lib/seed/fixtures";
import { getStore, type Store } from "@/lib/store";
import { JsonStore } from "@/lib/store/json";
import { runBudget } from "@/lib/agent/caps";
import { getLiveReel } from "@/lib/instagram";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import type { UiSnapshot } from "@/lib/ui/types";
import { DEMO_ROOM, ROOM_PATTERN } from "@/lib/ui/room";

// Which room a phone call is for. The phones send `?room=<id>` on every call (lib/ui/room.ts); a body may carry
// `room` too. "demo" or no room at all is the one demo room, exactly as before: its store, its HTTP inbox, `after`.
// A keyless judge code belongs to its /j link and is refused here. Any other valid id is a room of its own: a
// store of its own, saved as one document in the room table under p_<id>, made on the first write that is allowed to
// make one (a reel or a control), and a 404 for anything else before that.
//
// A room's agents cannot talk over the HTTP inbox, because the inbox is a route of its own with no way to know the
// room and no shared memory with this request. So in a room the two agents run in this process and hand each other
// their messages directly (localDeliver, the same path the inbox uses to validate), and `converse` runs the turns
// those messages cause. The demo room keeps the inbox.
//
// Limits, plainly: the document is loaded and saved whole, so two writes to one room at the same moment are
// serialized by a lock that exists inside one server instance only. Across instances the last save wins.

export const PHONE_ROOM_PREFIX = "p_";
const MAX_TURNS = 8;

export type Deliver = ReturnType<typeof httpDeliver>;

export type RoomScope = {
  id: string;
  isDemo: boolean;
  store: Store;
  // The agents' messages: over HTTP to the inbox for the demo room, in this process for any other room.
  deliver(origin: string, agent: AgentId): Deliver;
  // Agents that received a message in this process and owe a turn (rooms only; the demo inbox runs those itself).
  pending: AgentId[];
  // Work to do after the response: `after` as always for the demo room; in a room, under the room's lock, on the
  // room's latest saved state, saving as it goes.
  background(work: (scope: RoomScope) => Promise<void>): void;
};

export type RoomDeps = { repo: RoomRepo; now: () => number; schedule: (work: () => Promise<void>) => void; maxRoomsPerHour?: number };

export function roomDeps(): RoomDeps {
  return {
    repo: defaultRoomRepo(),
    now: Date.now,
    schedule: (work) => {
      try {
        after(work);
      } catch (error) {
        console.error("after() unavailable for a room job", error instanceof Error ? error.message : error);
        void work();
      }
    },
  };
}

// New rooms an hour across everyone. Every judge who scans the QR makes one, so it is far above the judge-code cap.
export function maxPhoneRooms(deps: RoomDeps): number {
  const configured = Number(process.env.PHONE_ROOMS_PER_HOUR);
  return deps.maxRoomsPerHour ?? (Number.isInteger(configured) && configured > 0 ? configured : 60);
}

export const phoneRoomKey = (id: string) => `${PHONE_ROOM_PREFIX}${id}`;

function refuse(status: number, code: string, message: string, headers?: Record<string, string>) {
  return NextResponse.json({ data: null, error: { code, message } }, { status, headers });
}

export type RoomChoice = { kind: "demo" } | { kind: "judge" } | { kind: "phone"; id: string } | { kind: "bad"; id: string };

// The room a request names, from the query or a body that is already parsed. Query wins.
export function chooseRoom(request: Request, body?: unknown): RoomChoice {
  const fromQuery = new URL(request.url).searchParams.get("room");
  const fromBody = body && typeof body === "object" && typeof (body as { room?: unknown }).room === "string" ? (body as { room: string }).room : null;
  const id = fromQuery ?? fromBody;
  if (id === null || id === "" || id === DEMO_ROOM) return { kind: "demo" };
  if (!ROOM_PATTERN.test(id)) return { kind: "bad", id };
  if (judgeKeyConfigured() && normalizeCode(id) === id) return { kind: "judge" };
  return { kind: "phone", id };
}

// The body of a call without its `room`, so routes can keep their strict schemas.
export function withoutRoom(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const rest = { ...(body as Record<string, unknown>) };
  delete rest.room;
  return rest;
}

// A new room's state: the seeded empty stage, the demo room's wallet accounts (so no new sandbox customers are made
// for every room) at their starting balance with a ledger of their own, and nobody playing the friend yet.
export async function freshRoomSnapshot(now: number): Promise<StateSnapshot> {
  const base = seedSnapshot();
  const at = toCentralIso(now);
  let wallets: Record<string, Wallet> | undefined;
  try {
    const demo = await (await getStore()).getRoom();
    if (demo.wallets) wallets = Object.fromEntries(Object.entries(demo.wallets).map(([agent, wallet]) => [agent, { ...(wallet as Wallet), balance: (wallet as Wallet).startingBalance }]));
  } catch {
    wallets = undefined;
  }
  return { ...base, room: { ...DEFAULT_ROOM, id: "demo", simulatedFriend: false, resetCount: 0, updatedAt: at, ...(wallets ? { wallets: wallets as never } : {}) } };
}

export async function withRoom(
  request: Request,
  rawBody: unknown,
  options: { mint?: boolean },
  handler: (scope: RoomScope) => Promise<Response>,
  deps: RoomDeps = roomDeps(),
): Promise<Response> {
  const choice = chooseRoom(request, rawBody);
  if (choice.kind === "bad") return refuse(400, "bad_room", "A room id is 4 to 24 lowercase letters and digits.");
  if (choice.kind === "judge") return refuse(403, "judge_room", "That room belongs to its link and is not a phone room.");

  if (choice.kind === "demo") {
    const store = await getStore();
    const scope: RoomScope = {
      id: DEMO_ROOM,
      isDemo: true,
      store,
      pending: [],
      deliver: (origin, agent) => httpDeliver(origin, agent),
      background: (work) => after(() => work(scope)),
    };
    return handler(scope);
  }

  const key = phoneRoomKey(choice.id);
  try {
    return await withLock(`room:${key}`, async () => {
      const now = deps.now();
      let found = await deps.repo.lookup(key, now);
      if (found.status !== "live") {
        if (!options.mint) return refuse(404, "no_such_room", "No room with that id. It starts with the first reel or control.");
        await deps.repo.purgeExpired(now);
        const made = await deps.repo.countCreatedSince(now - ROOM_CAP_WINDOW_MS, PHONE_ROOM_PREFIX);
        if (made >= maxPhoneRooms(deps)) return refuse(429, "room_cap", `This site starts at most ${maxPhoneRooms(deps)} rooms an hour. Try again in a few minutes.`, { "Retry-After": "300" });
        await deps.repo.create(key, await freshRoomSnapshot(now), now);
        found = await deps.repo.lookup(key, now);
        if (found.status !== "live") return refuse(503, "rooms_unavailable", "Rooms are not set up on this server yet.");
      }
      const scope = await openScope(deps, key, choice.id, found.snapshot);
      try {
        const response = await handler(scope.value);
        await scope.flush();
        return response;
      } catch (error) {
        await scope.flush().catch(() => {});
        throw error;
      }
    });
  } catch (error) {
    if (error instanceof RoomStorageError) {
      console.error(error.message);
      return refuse(503, "rooms_unavailable", "Rooms are not set up on this server yet.");
    }
    throw error;
  }
}

async function openScope(deps: RoomDeps, key: string, id: string, snapshot: StateSnapshot): Promise<{ value: RoomScope; flush: () => Promise<void> }> {
  const inner = new JsonStore(null);
  await inner.replaceAll(snapshot);
  const persisted = persistingStore(inner, (next) => deps.repo.save(key, next));
  const scope: RoomScope = {
    id,
    isDemo: false,
    store: persisted.store,
    pending: [],
    deliver: (_origin, agent) =>
      localDeliver(persisted.store, agent, (accepted) => {
        if (accepted.runTurn) scope.pending.push(otherAgent(agent));
      }),
    background: (work) =>
      deps.schedule(() =>
        withLock(`room:${key}`, async () => {
          // The latest saved state, which includes everything the request that scheduled this wrote.
          const latest = await deps.repo.load(key, deps.now());
          if (!latest) return;
          const job = await openScope(deps, key, id, latest);
          try {
            await work(job.value);
          } catch (error) {
            console.error("room job failed", error instanceof Error ? error.message : error);
          } finally {
            await job.flush().catch((error) => console.error("room final save failed", error instanceof Error ? error.message : error));
          }
        }),
      ),
  };
  return { value: scope, flush: persisted.flush };
}

// Runs `first` (which sends messages), then, in a room, every turn those messages cause, in this process. In the demo
// room it only runs `first`: the inbox route takes each message from there.
export async function converse(scope: RoomScope, contextId: string, first: () => Promise<unknown>): Promise<void> {
  await first();
  if (scope.isDemo) return;
  for (let turns = 0; scope.pending.length > 0 && turns < MAX_TURNS; turns += 1) {
    const agent = scope.pending.shift()!;
    await runInboxTurn({ store: scope.store, agent, contextId, wallNow: Date.now, deliver: scope.deliver("", agent) });
  }
}

// What /api/state shows for a phone room: that room's own state, as the UI draws the demo room's. A room that has not
// been made yet (a phone that just scanned the QR has made nothing) shows the empty stage, built here and not saved,
// so the page can draw its start card; the first reel or control makes the room. Null for the demo room, a judge's
// link code and an id that is not a room id, which /api/state answers as before. The ETag is a hash of the document,
// because a room read from storage has no running counter.
export async function readPhoneRoom(request: Request, deps: RoomDeps = roomDeps()): Promise<{ etag: string; ui: UiSnapshot } | null> {
  const choice = chooseRoom(request);
  if (choice.kind !== "phone") return null;
  const now = deps.now();
  const found = await deps.repo.lookup(phoneRoomKey(choice.id), now);
  const snapshot = found.status === "live" ? found.snapshot : await freshRoomSnapshot(now);
  const etag = `room-${createHash("sha1").update(JSON.stringify(snapshot)).digest("hex").slice(0, 16)}`;
  return { etag, ui: toUiSnapshot(snapshot, { mode: "live", budget: runBudget(choice.id), liveReel: await getLiveReel() }) };
}
