import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Lets a test make the recording file unreadable, or strip its model proof, without touching the real file.
const file = vi.hoisted(() => ({ mode: "real" as "real" | "throws" | "no-proof" | "empty" }));
vi.mock("@/lib/seed/live", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/seed/live")>();
  return {
    ...original,
    liveRunBundle: () => {
      const bundle = original.liveRunBundle();
      if (file.mode === "throws") throw new Error("live-run.json is not valid");
      if (file.mode === "empty") return { ...bundle, run: { ...bundle.run, snapshot: { ...bundle.run.snapshot, messages: [] } } };
      if (file.mode === "no-proof") {
        const messages = bundle.run.snapshot.messages.map((record) => {
          const withoutProof = { ...record };
          delete withoutProof.proof;
          return withoutProof;
        });
        return { ...bundle, run: { ...bundle.run, snapshot: { ...bundle.run.snapshot, messages } } };
      }
      return bundle;
    },
  };
});

import { GET as replayGet } from "@/app/api/replay/route";
import { ReplayBadge } from "@/components/ReplayBadge";
import { copy, recordingDate } from "@/lib/ui/copy";
import { loadReplay, recordedRun, scriptedRun } from "@/lib/ui/replay-source";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import { recordedSnapshot } from "@/lib/seed/fixtures";
import { getStore } from "@/lib/store";
import { JsonStore } from "@/lib/store/json";

afterEach(() => {
  file.mode = "real";
  vi.unstubAllEnvs();
  delete (globalThis as { __museStore?: unknown }).__museStore;
});

describe("the real recording", () => {
  it("is the committed live run: source live, messages that all carry model proof, a recording date", () => {
    const run = recordedRun();
    expect(run).not.toBeNull();
    expect(run!.source).toBe("live");
    expect(run!.snapshot.messages.length).toBeGreaterThanOrEqual(3);
    for (const record of run!.snapshot.messages) {
      expect(record.proof, `message ${record.message.seq}`).toBeDefined();
      expect(record.proof!.model).toMatch(/^muse-/);
    }
    expect(run!.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[56]:00$/);
    // Recorded on the current build: the first message carries the tool calls the agent made.
    expect(JSON.stringify(run!.snapshot.messages[0])).toContain("toolCalls");
  });

  it("is not used when the file does not parse, is empty, or any message lacks model proof", () => {
    for (const mode of ["throws", "empty", "no-proof"] as const) {
      file.mode = mode;
      expect(recordedRun(), mode).toBeNull();
    }
  });
});

describe("loadReplay", () => {
  it("plays the real recording with its model proof, not the script, from an empty store", async () => {
    const replay = await loadReplay(new JsonStore(null));
    expect(replay.id).toBe("run_shawarma_live");
    expect(replay.source).toBe("live");
    expect(replay.id).not.toBe("run_scripted_full");
    expect(replay.recordedAt).toBe(recordedRun()!.recordedAt);
    const last = replay.frames.at(-1)!.snapshot;
    expect(last.messages.length).toBeGreaterThanOrEqual(3);
    for (const message of last.messages) expect(message.proof, `message ${message.seq}`).toBeDefined();
    expect(last.plan?.state).toBe("followed_up");
    // Every frame says which recording it is, for the badge.
    for (const frame of replay.frames) expect(frame.snapshot.recording).toEqual({ source: "live", recordedAt: replay.recordedAt });
    expect(replay.frames.every((frame) => frame.snapshot.mode === "replay")).toBe(true);
  });

  it("falls back to the hand-written script, which says it is scripted, only when the file cannot be used", async () => {
    for (const mode of ["throws", "empty", "no-proof"] as const) {
      file.mode = mode;
      const replay = await loadReplay(new JsonStore(null));
      expect(replay.id, mode).toBe("run_scripted_full");
      expect(replay.source, mode).toBe("scripted");
      expect(replay.frames.at(-1)!.snapshot.recording?.source, mode).toBe("scripted");
    }
  });

  it("lets a newer live run saved from the stage replace the recording, and not an older one or a scripted one", async () => {
    const recording = recordedRun()!;
    const newer = { ...recording, id: "run_saved_newer", recordedAt: "2026-10-25T09:00:00-05:00" };
    const older = { ...recording, id: "run_saved_older", recordedAt: "2026-10-20T09:00:00-05:00" };
    const scripted = { ...scriptedRun(), id: "run_saved_scripted", recordedAt: "2026-10-25T10:00:00-05:00" };

    const withNewer = new JsonStore(null);
    await withNewer.saveRecordedRun(newer);
    expect((await loadReplay(withNewer)).id).toBe("run_saved_newer");

    const withOthers = new JsonStore(null);
    await withOthers.saveRecordedRun(older);
    await withOthers.saveRecordedRun(scripted);
    expect((await loadReplay(withOthers)).id).toBe("run_shawarma_live");
  });
});

describe("GET /api/replay", () => {
  it("returns frames whose messages carry model proof, labeled as a live recording with its date", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "muse-replay-"));
    vi.stubEnv("STORE", "json");
    vi.stubEnv("STORE_PATH", path.join(dir, "store.json"));
    delete (globalThis as { __museStore?: unknown }).__museStore;
    await getStore();
    const response = await replayGet();
    const body = await response.json();
    expect(body.error).toBeNull();
    expect(body.data).toMatchObject({ id: "run_shawarma_live", source: "live", recordedAt: recordedRun()!.recordedAt });
    const last = body.data.frames.at(-1).snapshot;
    expect(last.messages.length).toBeGreaterThanOrEqual(3);
    for (const message of last.messages) expect(message.proof?.model).toMatch(/^muse-/);
    expect(last.recording).toEqual({ source: "live", recordedAt: recordedRun()!.recordedAt });
  });
});

describe("the Replay badge names the recording date", () => {
  const live = { source: "live" as const, recordedAt: "2026-10-25T03:25:34-05:00" };

  it("formats the date from the recording's own time", () => {
    expect(recordingDate("2026-10-25T03:25:34-05:00")).toBe("Oct 25");
    expect(recordingDate("2026-11-02T23:59:00-06:00")).toBe("Nov 2");
    expect(recordingDate("nonsense")).toBe("an earlier date");
  });

  it("says a real run and its date, in the long and the short form; the script says it is scripted", () => {
    expect(copy.replayBadge(live, false)).toBe("Replay of a real run, recorded Oct 25");
    expect(copy.replayBadge(live, true)).toBe("Replay, recorded Oct 25");
    expect(copy.replayBadge({ source: "scripted", recordedAt: "2026-10-25T14:00:00-05:00" }, false)).toBe("Replay of a scripted run");
    expect(copy.replayBadge({ source: "scripted", recordedAt: "2026-10-25T14:00:00-05:00" }, true)).toBe("Replay, scripted");
    expect(copy.replayBadge(undefined, false)).toBe("Replay of a recorded run");
    expect(copy.replayBadge(undefined, true)).toBe("Replay");
  });

  it("renders the date in the badge on the stage and on a phone, and shows Live for a live snapshot", () => {
    const stage = renderToStaticMarkup(createElement(ReplayBadge, { mode: "replay", recording: live }));
    expect(stage).toContain("Replay of a real run, recorded Oct 25");
    expect(stage).toContain('role="status"');
    const phone = renderToStaticMarkup(createElement(ReplayBadge, { mode: "replay", compact: true, recording: live }));
    expect(phone).toContain("Replay, recorded Oct 25");
    expect(renderToStaticMarkup(createElement(ReplayBadge, { mode: "live" }))).toContain("Live");
  });

  it("only replay frames carry a recording; a live snapshot does not", () => {
    expect(toUiSnapshot(recordedSnapshot(), { mode: "live" })).not.toHaveProperty("recording");
    expect(toUiSnapshot(recordedSnapshot(), { mode: "replay", recording: live }).recording).toEqual(live);
  });
});
