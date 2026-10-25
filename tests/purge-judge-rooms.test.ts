import { describe, expect, it } from "vitest";
import { purgeJudgeRooms } from "../scripts/purge-judge-rooms.mjs";

// A stand-in for the one slice of the Supabase client the script uses: count, delete with a filter, count.
function fakeClient(rows: string[], failures: { count?: string; remove?: string } = {}) {
  const calls: string[] = [];
  const client = {
    from(table: string) {
      calls.push(`from:${table}`);
      return {
        select: async (_columns: string, options: { count: string; head: boolean }) => {
          calls.push(`select:${options.count}:${options.head}`);
          return failures.count ? { count: null, error: { message: failures.count } } : { count: rows.length, error: null };
        },
        delete: (options: { count: string }) => ({
          neq: async (column: string, value: string) => {
            calls.push(`delete:${options.count}:${column}!=${JSON.stringify(value)}`);
            if (failures.remove) return { count: null, error: { message: failures.remove } };
            const removed = rows.splice(0, rows.length);
            return { count: removed.length, error: null };
          },
        }),
      };
    },
  };
  return { client, calls, rows };
}

describe("purge-judge-rooms", () => {
  it("counts and deletes nothing without --yes", async () => {
    const { client, calls, rows } = fakeClient(["room_a", "room_b"]);
    const result = await purgeJudgeRooms(client, { yes: false });
    expect(result).toEqual({ before: 2, deleted: 0, after: 2, dryRun: true });
    expect(rows).toHaveLength(2);
    expect(calls.some((call) => call.startsWith("delete"))).toBe(false);
  });

  it("deletes every row of byom_rooms with --yes, and counts again", async () => {
    const { client, calls, rows } = fakeClient(["room_a", "room_b", "room_c"]);
    const result = await purgeJudgeRooms(client, { yes: true });
    expect(result).toEqual({ before: 3, deleted: 3, after: 0, dryRun: false });
    expect(rows).toHaveLength(0);
    // Only the judge table is ever named.
    expect(new Set(calls.filter((call) => call.startsWith("from:")))).toEqual(new Set(["from:byom_rooms"]));
    expect(calls).toContain('delete:exact:room_key!=""');
  });

  it("handles an empty table", async () => {
    expect(await purgeJudgeRooms(fakeClient([]).client, { yes: true })).toEqual({ before: 0, deleted: 0, after: 0, dryRun: false });
  });

  it("throws, saying which step failed, when the count or the delete is refused", async () => {
    await expect(purgeJudgeRooms(fakeClient([], { count: "relation does not exist" }).client, { yes: true })).rejects.toThrow("could not count byom_rooms: relation does not exist");
    await expect(purgeJudgeRooms(fakeClient(["room_a"], { remove: "permission denied" }).client, { yes: true })).rejects.toThrow("could not delete from byom_rooms: permission denied");
  });
});
