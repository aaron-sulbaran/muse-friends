import { describe, expect, it } from "vitest";
import { DEMO_ROOM, newRoomId, roomFromSearch, withRoom } from "@/lib/ui/room";

describe("which room a phone is in", () => {
  it("reads ?room= from the address, and falls back to the shared demo room", () => {
    expect(roomFromSearch("?room=k3x9qa")).toBe("k3x9qa");
    expect(roomFromSearch("?friend=1&room=k3x9qa")).toBe("k3x9qa");
    expect(roomFromSearch("")).toBe(DEMO_ROOM);
    expect(roomFromSearch("?friend=1")).toBe(DEMO_ROOM);
  });

  it("treats anything that is not a short lowercase id as no room", () => {
    for (const bad of ["?room=", "?room=ab", "?room=UPPER1", "?room=has space", "?room=../x", "?room=" + "a".repeat(25)]) {
      expect(roomFromSearch(bad)).toBe(DEMO_ROOM);
    }
  });

  it("makes ids a phone can use: six lowercase letters and digits, and different each time", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newRoomId()));
    expect(ids.size).toBeGreaterThan(45);
    for (const id of ids) expect(roomFromSearch(`?room=${id}`)).toBe(id);
    expect(newRoomId(() => 0)).toBe("000000");
    expect(newRoomId(() => 2 ** 32 - 1)).toHaveLength(6);
  });

  it("adds the room to an address, and leaves the demo room's addresses as they were", () => {
    expect(withRoom("/api/controls", "k3x9qa")).toBe("/api/controls?room=k3x9qa");
    expect(withRoom("/api/state?x=1", "k3x9qa")).toBe("/api/state?x=1&room=k3x9qa");
    expect(withRoom("/api/controls", DEMO_ROOM)).toBe("/api/controls");
  });
});
