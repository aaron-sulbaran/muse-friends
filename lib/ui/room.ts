/*
 * Which room a phone talks to. The store has one room today, "demo"; when rooms are isolated per judge (Lane P's
 * room-per-session work) a phone says which one with `?room=` in its address and every call carries it. Until the
 * server reads it, the parameter is harmless: it is ignored and everyone shares "demo", as before.
 */

export const DEMO_ROOM = "demo";

const ROOM_PATTERN = /^[a-z0-9]{4,24}$/;

/** The room an address names, or "demo". Anything that is not a short lowercase id counts as no room. */
export function roomFromSearch(search: string): string {
  const value = new URLSearchParams(search).get("room");
  return value !== null && ROOM_PATTERN.test(value) ? value : DEMO_ROOM;
}

/** A short random room id for a judge who just scanned the QR: six lowercase letters and digits. */
export function newRoomId(randomWord: () => number = () => crypto.getRandomValues(new Uint32Array(1))[0]): string {
  return randomWord().toString(36).padStart(6, "0").slice(-6);
}

/** The address with `room=` added, unless it is the shared demo room, which keeps today's addresses unchanged. */
export function withRoom(url: string, room: string): string {
  if (room === DEMO_ROOM) return url;
  return `${url}${url.includes("?") ? "&" : "?"}room=${room}`;
}

/**
 * The room this page is in, read from its address when asked: the address does not change under a page, so there is
 * no state to keep and nothing to subscribe to. On the server (and for the laptop stage, which has no `?room=`)
 * it is the shared demo room.
 */
export function getRoom(): string {
  return typeof window === "undefined" ? DEMO_ROOM : roomFromSearch(window.location.search);
}

/**
 * The state request for a room. A phone says which side it is (`role=a` or `role=b`) so the server can leave out what
 * is private to the other side (side a's chat with its Muse); the stage asks without a role and gets everything.
 */
export function stateUrl(room: string, role?: "a" | "b"): string {
  return `/api/state?room=${room}${role ? `&role=${role}` : ""}`;
}
