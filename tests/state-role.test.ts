import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/state/route";
import { recordCurrentRun } from "@/lib/agent/controls";
import { chatInstructions } from "@/lib/agent/chat-prompts";
import { seedSnapshot } from "@/lib/seed/fixtures";
import { JsonStore } from "@/lib/store/json";

// The chat with a Muse (D31) belongs to side a. The snapshot is otherwise the same for both phones, so a phone that
// says it is side b (/api/state?role=b) must not receive a word of it.

const QUESTION = "should I tell Dana about the surprise party money";
let store: JsonStore;

beforeEach(async () => {
  store = new JsonStore(null);
  await store.replaceAll(seedSnapshot());
  (globalThis as { __museStore?: unknown }).__museStore = Promise.resolve(store);
  await store.putRoom({
    ...(await store.getRoom()),
    chat: [
      { id: "chat_q", from: "user", text: QUESTION, at: "2026-10-25T14:00:00-05:00" },
      { id: "chat_a", from: "muse", text: "That is your call, and I can only look things up here.", at: "2026-10-25T14:00:01-05:00", replyTo: "chat_q", proof: { model: "muse-spark-1.3", responseId: "resp_1", latencyMs: 900, inputTokens: 10, outputTokens: 5, reasoningTokens: 2, toolCalls: [{ name: "get_plan", args: "", result: "no plan yet" }] } },
    ],
  });
  await store.appendEvent({ id: "evt_ask", at: "2026-10-25T14:00:00-05:00", kind: "chat_asked", actor: "human", agent: "aaron", messageId: "chat_a", text: `You asked: ${QUESTION}` });
});
afterEach(() => {
  (globalThis as { __museStore?: unknown }).__museStore = undefined;
});

const fetchState = (query = "", headers: Record<string, string> = {}) => GET(new Request(`http://localhost:3001/api/state${query}`, { headers }));

describe("GET /api/state?role=", () => {
  it("gives side b a snapshot with no chat line and no 'You asked' row, anywhere in the body", async () => {
    const response = await fetchState("?role=b");
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain(QUESTION);
    expect(text).not.toContain("You asked");
    expect(text).not.toContain("I can only look things up here");
    const body = JSON.parse(text);
    expect(body.chat).toEqual([]);
    expect(body.notes.some((note: { kind: string }) => note.kind === "chat_asked")).toBe(false);
    // Only the chat is taken out: the rest of the snapshot (the reel read, the wallets, the plan) is still there.
    for (const key of ["reelRead", "wallets", "payments", "plan", "sharing", "reel"]) expect(body, key).toHaveProperty(key);
  });

  it("keeps the full view for the stage and the gate (no role) and for side a", async () => {
    for (const query of ["", "?role=a"]) {
      const body = await (await fetchState(query)).json();
      expect(body.chat.map((line: { from: string }) => line.from)).toEqual(["user", "muse"]);
      expect(body.chat[0].text).toBe(QUESTION);
      expect(body.notes.find((note: { kind: string }) => note.kind === "chat_asked")).toMatchObject({ answerId: "chat_a", toolCalls: [{ name: "get_plan" }] });
    }
  });

  it("fails closed: any other role gets the restricted view", async () => {
    for (const query of ["?role=c", "?role=", "?role=A", "?role=a%20b"]) {
      const text = await (await fetchState(query)).text();
      expect(text, query).not.toContain(QUESTION);
    }
  });

  it("gives the restricted view its own ETag, so a 304 never carries one view's body into the other", async () => {
    const full = await fetchState("");
    const restricted = await fetchState("?role=b");
    const fullTag = full.headers.get("etag")!;
    const restrictedTag = restricted.headers.get("etag")!;
    expect(fullTag).not.toBe(restrictedTag);
    expect(restrictedTag.endsWith('-b"')).toBe(true);
    expect((await fetchState("?role=b", { "if-none-match": restrictedTag })).status).toBe(304);
    expect((await fetchState("?role=b", { "if-none-match": fullTag })).status).toBe(200);
    expect((await fetchState("", { "if-none-match": fullTag })).status).toBe(304);
    // Side a's view is not the stage's (it leaves out what side b typed about its own week), so it has its own tag too.
    const sideA = await fetchState("?role=a");
    const sideATag = sideA.headers.get("etag")!;
    expect(sideATag).not.toBe(fullTag);
    expect(sideATag.endsWith('-a"')).toBe(true);
    expect((await fetchState("?role=a", { "if-none-match": sideATag })).status).toBe(304);
    expect((await fetchState("?role=a", { "if-none-match": fullTag })).status).toBe(200);
  });
});

describe("what a recording keeps", () => {
  it("does not bake the private chat into a recorded run that everyone can replay", async () => {
    const run = await recordCurrentRun(store, { id: "run_chat", label: "with a chat" });
    expect(run.snapshot.room.chat).toBeUndefined();
    expect(JSON.stringify(run.snapshot)).not.toContain(QUESTION);
    // The live room is untouched.
    expect((await store.getRoom()).chat).toHaveLength(2);
  });
});

describe("the chat voice", () => {
  it("tells the Muse not to use em dashes or guess anyone's gender", () => {
    const instructions = chatInstructions("aaron");
    expect(instructions).toContain("Never use em dashes");
    expect(instructions).toContain("Do not guess anyone's gender");
  });
});
