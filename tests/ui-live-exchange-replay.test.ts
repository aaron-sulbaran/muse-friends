import { describe, expect, it } from "vitest";
import { liveShawarmaRun } from "@/lib/seed/live";
import { viewForRole, type ChatItem } from "@/lib/ui/chat";
import { buildReplay } from "@/lib/ui/replay";

// Replay is built from the recorded run, one frame per beat, with the same in-flight call each frame would have had live.
// So the typing bubble and the fold must play in Replay with nothing recorded for them.

const replay = buildReplay(liveShawarmaRun());
const frames = replay.frames.map((frame) => ({ snapshot: frame.snapshot, items: viewForRole(frame.snapshot, "a").items }));
const kindsOf = (items: ChatItem[]) => items.map((item) => item.kind);
const talk = (items: ChatItem[]) => items.filter((item) => item.kind === "thread-line" && item.line.phase === "talk" && !item.line.onlyYou);

describe("the live exchange in Replay", () => {
  it("shows a typing bubble on at least one frame while the Muses talk", () => {
    const typing = frames.filter((frame) => kindsOf(frame.items).includes("thread-typing"));
    expect(typing.length).toBeGreaterThan(0);
    expect(typing.every((frame) => ["detected", "negotiating"].includes(frame.snapshot.plan?.state ?? ""))).toBe(true);
  });

  it("grows the exchange frame by frame, the opening intent first", () => {
    const counts = frames.map((frame) => talk(frame.items).length);
    expect(counts.some((count) => count === 1)).toBe(true);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
    const withIntent = frames.find((frame) => talk(frame.items).length > 0)!;
    expect(talk(withIntent.items)[0]).toMatchObject({ line: { text: expect.stringContaining("Asked about") } });
  });

  it("ends folded: no exchange lines, the agreed line, and no typing", () => {
    const last = replay.frames.at(-1)!.snapshot;
    const folded = viewForRole(last, "a", { exchangeOpen: false }).items;
    expect(talk(folded)).toEqual([]);
    expect(kindsOf(folded)).toContain("agreed-line");
    expect(kindsOf(folded)).not.toContain("thread-typing");
  });
});
