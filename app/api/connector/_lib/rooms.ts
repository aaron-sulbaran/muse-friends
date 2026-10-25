import type { SupabaseClient } from "@supabase/supabase-js";
import type { StateSnapshot } from "@/lib/protocol";
import { createServiceClient } from "@/lib/store/supabase";

// Where a judge's rooms live. One JSON document per room, apart from the demo room's tables, so a
// judge's plan can never appear on the stage and the demo's Reset can never wipe it.
export const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
export const ROOM_CAP_WINDOW_MS = 60 * 60 * 1000;

// What a lookup finds: a live room with its expiry, one past its expiry that nobody has deleted yet, or nothing.
export type RoomLookup = { status: "live"; snapshot: StateSnapshot; expiresAt: number } | { status: "expired" } | { status: "missing" };

export type RoomRepo = {
  create(roomKey: string, snapshot: StateSnapshot, now: number): Promise<void>;
  // The room's snapshot, or null when there is none or it has expired. Expired rooms are never served.
  load(roomKey: string, now: number): Promise<StateSnapshot | null>;
  // Like load, but says whether a missing room was never there or has just expired (a link answers 404 or 410).
  lookup(roomKey: string, now: number): Promise<RoomLookup>;
  save(roomKey: string, snapshot: StateSnapshot): Promise<void>;
  // How many rooms were created at or after `sinceMs`, for the cap on rooms per hour. With a prefix, only the
  // rooms whose key starts with it (phone rooms are p_..., judge rooms j_... and room_...).
  countCreatedSince(sinceMs: number, prefix?: string): Promise<number>;
  // Deletes rooms past their expiry; returns how many.
  purgeExpired(now: number): Promise<number>;
};

export class RoomStorageError extends Error {
  constructor(operation: string, detail: string) {
    super(`room storage ${operation} failed: ${detail}`);
    this.name = "RoomStorageError";
  }
}

type Stored = { snapshot: StateSnapshot; createdAt: number; expiresAt: number };

// Local development and tests: one process, gone on restart. Production uses Supabase.
export function memoryRoomRepo(): RoomRepo {
  const holder = globalThis as typeof globalThis & { __museByomRooms?: Map<string, Stored> };
  const rooms = (holder.__museByomRooms ??= new Map<string, Stored>());
  return {
    async create(roomKey, snapshot, now) {
      rooms.set(roomKey, { snapshot: structuredClone(snapshot), createdAt: now, expiresAt: now + ROOM_TTL_MS });
    },
    async load(roomKey, now) {
      const stored = rooms.get(roomKey);
      return stored && stored.expiresAt > now ? structuredClone(stored.snapshot) : null;
    },
    async lookup(roomKey, now) {
      const stored = rooms.get(roomKey);
      if (!stored) return { status: "missing" };
      return stored.expiresAt > now ? { status: "live", snapshot: structuredClone(stored.snapshot), expiresAt: stored.expiresAt } : { status: "expired" };
    },
    async save(roomKey, snapshot) {
      const stored = rooms.get(roomKey);
      if (stored) stored.snapshot = structuredClone(snapshot);
    },
    async countCreatedSince(sinceMs, prefix) {
      return [...rooms.entries()].filter(([key, stored]) => stored.createdAt >= sinceMs && (prefix === undefined || key.startsWith(prefix))).length;
    },
    async purgeExpired(now) {
      let removed = 0;
      for (const [key, stored] of rooms) {
        if (stored.expiresAt <= now) {
          rooms.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
  };
}

export function clearMemoryRooms(): void {
  (globalThis as typeof globalThis & { __museByomRooms?: Map<string, Stored> }).__museByomRooms?.clear();
}

export function supabaseRoomRepo(db: SupabaseClient): RoomRepo {
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    async create(roomKey, snapshot, now) {
      const { error } = await db.from("byom_rooms").insert({ room_key: roomKey, snapshot, created_at: iso(now), expires_at: iso(now + ROOM_TTL_MS) });
      if (error) throw new RoomStorageError("create", error.message);
    },
    async load(roomKey, now) {
      const { data, error } = await db.from("byom_rooms").select("snapshot, expires_at").eq("room_key", roomKey).maybeSingle();
      if (error) throw new RoomStorageError("load", error.message);
      if (!data || Date.parse(data.expires_at as string) <= now) return null;
      return data.snapshot as StateSnapshot;
    },
    async lookup(roomKey, now) {
      const { data, error } = await db.from("byom_rooms").select("snapshot, expires_at").eq("room_key", roomKey).maybeSingle();
      if (error) throw new RoomStorageError("lookup", error.message);
      if (!data) return { status: "missing" };
      const expiresAt = Date.parse(data.expires_at as string);
      return expiresAt > now ? { status: "live", snapshot: data.snapshot as StateSnapshot, expiresAt } : { status: "expired" };
    },
    async save(roomKey, snapshot) {
      const { error } = await db.from("byom_rooms").update({ snapshot }).eq("room_key", roomKey);
      if (error) throw new RoomStorageError("save", error.message);
    },
    async countCreatedSince(sinceMs, prefix) {
      let query = db.from("byom_rooms").select("room_key", { count: "exact", head: true }).gte("created_at", iso(sinceMs));
      if (prefix !== undefined) query = query.like("room_key", `${prefix.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
      const { count, error } = await query;
      if (error) throw new RoomStorageError("count", error.message);
      return count ?? 0;
    },
    async purgeExpired(now) {
      const { data, error } = await db.from("byom_rooms").delete().lt("expires_at", iso(now)).select("room_key");
      if (error) throw new RoomStorageError("purge", error.message);
      return data?.length ?? 0;
    },
  };
}

// Production keeps rooms in Supabase (STORE=supabase, as the demo store does); anywhere else they live in memory.
export function defaultRoomRepo(): RoomRepo {
  return process.env.STORE === "supabase" ? supabaseRoomRepo(createServiceClient()) : memoryRoomRepo();
}
