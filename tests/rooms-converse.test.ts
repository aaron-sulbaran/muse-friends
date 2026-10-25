import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// No model and no real delivery: the agent runtime and the wire are replaced, so what is checked is which turns a room
// owes after a message, and on which thread.
const calls = vi.hoisted(() => [] as Array<{ agent: string; contextId: string }>);
const accept = vi.hoisted(() => ({ runTurn: true }));
vi.mock("@/lib/agent/runtime", () => ({
  runInboxTurn: async (options: { agent: string; contextId: string }) => {
    calls.push({ agent: options.agent, contextId: options.contextId });
    return { status: "completed", finalText: "", nudged: false, toolCalls: [], calls: [], totalMs: 0 };
  },
}));
vi.mock("@/lib/agent/wire", () => ({
  httpDeliver: () => async () => ({ ok: true }),
  localDeliver: (_store: unknown, _sender: string, onAccepted?: (result: { runTurn: boolean }) => void) => async () => {
    onAccepted?.({ runTurn: accept.runTurn });
    return { ok: true };
  },
}));

import { converse, withRoom, type RoomDeps } from "@/app/api/_lib/room";
import { clearMemoryRooms, memoryRoomRepo } from "@/app/api/connector/_lib/rooms";

const deps = (): RoomDeps => ({ repo: memoryRoomRepo(), now: () => Date.now(), schedule: () => {} });
const inRoom = (handler: Parameters<typeof withRoom>[3]) => withRoom(new Request("https://muse-friends.test/api/x?room=converse01"), undefined, { mint: true }, handler, deps());
const message = (to: string, contextId: string) => ({ record: { message: { to, contextId } }, redaction: undefined }) as never;

beforeEach(() => {
  calls.length = 0;
  accept.runTurn = true;
  clearMemoryRooms();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("the turns a room owes", () => {
  it("records the recipient and the thread of each message that needs a turn, whoever it is for", async () => {
    await inRoom(async (room) => {
      await room.deliver("", "aaron")(message("lisa", "ctx_pair"));
      await room.deliver("", "aaron")(message("kai", "ctx_group_two"));
      expect(room.pending).toEqual([
        { agent: "lisa", contextId: "ctx_pair" },
        { agent: "kai", contextId: "ctx_group_two" },
      ]);
      return Response.json({});
    });
  });

  it("owes nothing for a message that ends its thread, or that the receiving side refused", async () => {
    await inRoom(async (room) => {
      accept.runTurn = false;
      await room.deliver("", "aaron")(message("lisa", "ctx_pair"));
      expect(room.pending).toEqual([]);
      return Response.json({});
    });
  });

  it("runs each owed turn for its own recipient on its own thread, in order, after the first step", async () => {
    await inRoom(async (room) => {
      await converse(room, "ctx_main", async () => {
        await room.deliver("", "aaron")(message("lisa", "ctx_main"));
        await room.deliver("", "aaron")(message("kai", "ctx_group_two"));
      });
      return Response.json({});
    });
    expect(calls).toEqual([
      { agent: "lisa", contextId: "ctx_main" },
      { agent: "kai", contextId: "ctx_group_two" },
    ]);
  });

  it("stops after a bounded number of turns, so two agents cannot talk forever", async () => {
    await inRoom(async (room) => {
      await converse(room, "ctx_main", async () => {
        for (let index = 0; index < 20; index += 1) room.pending.push({ agent: "lisa", contextId: "ctx_main" });
      });
      return Response.json({});
    });
    expect(calls).toHaveLength(8);
  });

  it("leaves the turns to the inbox in the demo room: nothing is queued or run here", async () => {
    const response = await withRoom(new Request("https://muse-friends.test/api/x"), undefined, {}, async (room) => {
      await converse(room, "ctx_main", async () => {
        await room.deliver("http://x", "aaron")(message("lisa", "ctx_main"));
      });
      expect(room.pending).toEqual([]);
      return Response.json({});
    }, deps());
    expect(response.status).toBe(200);
    expect(calls).toEqual([]);
  });
});
