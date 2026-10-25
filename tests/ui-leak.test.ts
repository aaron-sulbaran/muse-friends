import { recordedSnapshot } from "@/lib/seed/fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postInbox } from "@/app/api/agents/[id]/inbox/route";
import { POST as postLeak } from "@/app/api/proof/leak/route";
import { forgedMessage, tryToLeak } from "@/lib/ui/leak";
import { seedSnapshot } from "@/lib/seed/fixtures";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import { JsonStore } from "@/lib/store/json";

// The forgeries go through the real inbox route against a real JsonStore, the way the app runs.
let store: JsonStore;
beforeEach(async () => {
  store = new JsonStore(null);
  await store.replaceAll(seedSnapshot());
  (globalThis as { __museStore?: Promise<JsonStore> }).__museStore = Promise.resolve(store);
});
afterEach(() => {
  delete (globalThis as { __museStore?: unknown }).__museStore;
  vi.unstubAllGlobals();
});

/** The inbox route as a `fetch`, so the test needs no server. */
const inbox = async (url: string, init: RequestInit) => {
  const id = new URL(url).pathname.split("/").at(-2)!;
  return postInbox(new Request(url, init), { params: Promise.resolve({ id }) });
};

describe("try to leak", () => {
  it("is refused twice, with the inbox's own words, and delivers nothing", async () => {
    const attempts = await tryToLeak("http://localhost", inbox);
    expect(attempts.map((attempt) => attempt.id)).toEqual(["wrong_bearer", "private_note"]);
    expect(attempts[0]).toMatchObject({ status: 401, error: "missing or invalid bearer token", rejected: true });
    expect(attempts[1]).toMatchObject({ status: 422, rejected: true });
    expect(attempts[1].error).toMatch(/sharing policy does not allow \(events\)/);
    expect((await store.snapshot()).messages).toHaveLength(0);
    expect((await store.snapshot()).threads).toHaveLength(0);
  });

  it("leaves a policy rejection on the timeline as a row the UI can show, and a wrong bearer leaves none", async () => {
    await tryToLeak("http://localhost", inbox);
    const state = await store.snapshot();
    const rejections = state.events.filter((event) => event.kind === "message_rejected");
    expect(rejections).toHaveLength(1);
    expect(rejections[0].text).toMatch(/inbox rejected a message from .+ \(422\)/);
    const notes = toUiSnapshot(state, { mode: "live" }).notes;
    // Shown as privacy proof, with the technical text kept as the row's hover detail.
    expect(notes).toEqual([expect.objectContaining({ kind: "message_rejected", detail: rejections[0].text })]);
    expect(notes[0].text).toMatch(/^(Blocked|Held back): /);
  });

  it("forges a message that is valid in every way but its note, so the policy is what refuses it", () => {
    const message = forgedMessage(1_700_000_000_000);
    expect(message).toMatchObject({ from: "aaron", to: "lisa", seq: 1, type: "intent", state: "working" });
    expect(message.note).toContain("Northwind");
  });

  it("answers the route with both attempts", async () => {
    vi.stubGlobal("fetch", inbox);
    const response = await postLeak(new Request("http://localhost/api/proof/leak", { method: "POST" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { attempts: Array<{ status: number }> } | null };
    expect(body.data?.attempts.map((attempt) => attempt.status)).toEqual([401, 422]);
  });
});

describe("a rejection reads as privacy proof, one sentence per reason", () => {
  const reject = (reason: string, status = 422) => {
    const state = recordedSnapshot();
    state.events.push({ id: `evt_rej_${status}_${reason.length}`, at: state.clock.now, kind: "message_rejected", actor: "system", agent: "lisa", text: `Mochi's inbox rejected a message from Sprout (${status}): ${reason}` });
    return toUiSnapshot(state, { mode: "live" }).notes.find((note) => note.kind === "message_rejected");
  };

  it.each([
    ["the message carries data the sender's sharing policy does not allow (events)", 422, "Blocked: Sprout tried to share events with Mochi; the sharing settings don't allow it"],
    ["a window is outside the sender's free blocks", 422, "Blocked: Sprout offered a time that isn't really free; only real free times go out"],
    ["a window was already passed over in this conversation", 422, "Blocked: Sprout offered a time that was already turned down"],
    ["from does not match the authenticated sender", 403, "Blocked: a message that didn't come from Sprout was refused"],
    ["the sixth message must be an accept or a decline", 422, "Held back: an out-of-turn message from Sprout was stopped before it reached Mochi"],
  ])("%s", (reason, status, sentence) => {
    const note = reject(reason, status);
    expect(note?.text).toBe(sentence);
    expect(note?.detail).toContain(`(${status}): ${reason}`);
  });
});
