import { describe, expect, it } from "vitest";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { copy } from "@/lib/ui/copy";
import { messageTitle } from "@/lib/ui/format";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import { endsRun, startsRun, threadLines, type ThreadLine } from "@/lib/ui/thread";
import type { Decision, UiMessage, UiSnapshot } from "@/lib/ui/types";

const live = { mode: "live" } as const;

/** The agreed run from the fixtures: intent, propose, counter, counter, accept, accept. */
function agreed(): UiSnapshot {
  return toUiSnapshot(snapshotAtPlanState("awaiting_humans"), live);
}

/** The snapshot with only the messages named, in the order given. */
function withMessages(snapshot: UiSnapshot, ids: string[], change: (message: UiMessage) => UiMessage = (message) => message): UiSnapshot {
  return { ...snapshot, messages: ids.map((id) => change(snapshot.messages.find((message) => message.id === id)!)) };
}

function withMichelle(snapshot: UiSnapshot, decision: Decision): UiSnapshot {
  return { ...snapshot, simulatedFriend: true, plan: { ...snapshot.plan!, decisions: { a: "pending", b: decision } } };
}

const kinds = (lines: ThreadLine[]) => lines.map((line) => line.sender.kind);

describe("a Muse's line for each turn that changed the plan", () => {
  // propose by Mochi, counter by Sprout, accept by Mochi: three turns, two Muses.
  const run = withMessages(agreed(), ["msg_shawarma_002", "msg_shawarma_003", "msg_shawarma_006"]);

  it("gives one line per turn, in order, in the wording the timeline already uses", () => {
    const lines = threadLines(run, "a");
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.text)).toEqual(run.messages.map(messageTitle));
    expect(lines.map((line) => line.id)).toEqual(["thread-msg_shawarma_002", "thread-msg_shawarma_003", "thread-msg_shawarma_006"]);
  });

  it("signs each with the Muse's own name and says whose Muse it is, from Sprout's phone", () => {
    const lines = threadLines(run, "a");
    expect(kinds(lines)).toEqual(["friend-muse", "your-muse", "friend-muse"]);
    expect(lines.map((line) => line.sender.name)).toEqual(["Mochi", "Sprout", "Mochi"]);
    expect(lines.map((line) => line.sender.owner)).toEqual(["Mochi", "Sprout", "Mochi"]);
    expect(lines.map((line) => line.sender.agent)).toEqual(["lisa", "aaron", "lisa"]);
  });

  it("flips whose Muse is whose from the other phone", () => {
    expect(kinds(threadLines(run, "b"))).toEqual(["your-muse", "friend-muse", "your-muse"]);
  });

  it("names the people who own the Muses when the friend is Michelle", () => {
    const lines = threadLines({ ...run, simulatedFriend: true }, "a");
    expect(lines.map((line) => line.sender.name)).toEqual(["Mochi", "Sprout", "Mochi"]);
    expect(lines.map((line) => line.sender.owner)).toEqual(["Michelle", "Sprout", "Michelle"]);
  });

  it("leaves the opening intent out, because it opens the thread rather than moving the plan", () => {
    const lines = threadLines(agreed(), "a");
    expect(lines.some((line) => line.id === "thread-msg_shawarma_001")).toBe(false);
    expect(lines).toHaveLength(5);
  });

  it("keeps a decline, which does move the plan", () => {
    const declined = withMessages(agreed(), ["msg_shawarma_002"], (message) => ({ ...message, type: "decline", reason: "no_overlap" }));
    expect(threadLines(declined, "a").map((line) => line.text)).toEqual(["Declined: no time works"]);
  });
});

describe("what is not part of the conversation", () => {
  it("yields nothing for a message outside the plan's context", () => {
    const snapshot = agreed();
    const stranger = { ...snapshot.messages[1], id: "msg_elsewhere", contextId: "ctx_somewhere_else" };
    const lines = threadLines({ ...snapshot, messages: [...snapshot.messages, stranger] }, "a");
    expect(lines.some((line) => line.id.includes("msg_elsewhere"))).toBe(false);
    expect(threadLines({ ...snapshot, messages: [stranger] }, "a")).toEqual([]);
  });

  it("yields nothing before there is a plan", () => {
    expect(threadLines({ ...agreed(), plan: null }, "a")).toEqual([]);
  });

  it("yields nothing for a message the receiving inbox refused", () => {
    const refused = withMessages(agreed(), ["msg_shawarma_002"], (message) => ({ ...message, blockedRule: "the sharing policy does not allow events" }));
    expect(threadLines(refused, "a")).toEqual([]);
  });
});

describe("the simulated friend's own lines", () => {
  it("appear only once her decision is in, and carry simulated: true", () => {
    expect(threadLines(withMichelle(agreed(), "pending"), "a").some((line) => line.sender.kind === "friend")).toBe(false);
    const accepted = threadLines(withMichelle(agreed(), "accepted"), "a");
    const hers = accepted.filter((line) => line.sender.kind === "friend");
    expect(hers).toEqual([expect.objectContaining({ text: copy.threadFriendYes, sender: { kind: "friend", name: "Michelle", simulated: true } })]);
    expect(accepted.at(-1)).toBe(hers[0]);
  });

  it("says no when she declines", () => {
    const declined = threadLines(withMichelle(agreed(), "declined"), "a");
    expect(declined.at(-1)?.text).toBe(copy.threadFriendNo);
  });

  it("is her phone's own voice on side b, so it is you there", () => {
    const line = threadLines(withMichelle(agreed(), "accepted"), "b").at(-1);
    expect(line?.sender).toEqual({ kind: "you", name: "Michelle", simulated: true });
  });

  it("is never scripted for a real friend, whose lines are their own", () => {
    const real = { ...agreed(), simulatedFriend: false, plan: { ...agreed().plan!, decisions: { a: "pending" as const, b: "accepted" as const } } };
    expect(threadLines(real, "a").some((line) => line.sender.kind === "friend" || line.sender.kind === "you")).toBe(false);
  });
});

describe("a Muse's private word to its own person", () => {
  const redacted = withMessages(agreed(), ["msg_shawarma_003", "msg_shawarma_004"], (message) => ({ ...message, removed: ["location", "interests"] }));
  const asides = (lines: ThreadLine[]) => lines.filter((line) => line.onlyYou);

  it("is an only-you line on the phone of the person whose Muse sent the message, and not on the other", () => {
    // msg 003 is Sprout's counter, msg 004 is Mochi's.
    const onA = asides(threadLines(redacted, "a"));
    expect(onA).toHaveLength(1);
    expect(onA[0].sender).toMatchObject({ kind: "your-muse", name: "Sprout" });
    expect(onA[0].id).toBe("thread-msg_shawarma_003-aside");
    const onB = asides(threadLines(redacted, "b"));
    expect(onB).toHaveLength(1);
    expect(onB[0].sender).toMatchObject({ kind: "your-muse", name: "Mochi" });
  });

  it("says what was kept out, in the Muse's own voice and without the value", () => {
    const [aside] = asides(threadLines(redacted, "a"));
    expect(aside.text).toBe("I kept location and interests out of what I sent Mochi.");
  });

  it("follows its message in the thread", () => {
    const ids = threadLines(redacted, "a").map((line) => line.id);
    expect(ids.indexOf("thread-msg_shawarma_003-aside")).toBe(ids.indexOf("thread-msg_shawarma_003") + 1);
  });

  it("is absent when nothing was removed", () => {
    expect(asides(threadLines(agreed(), "a"))).toEqual([]);
  });
});

describe("your private conversation with your Muse", () => {
  const chat = [
    { id: "chat_1", from: "user" as const, text: "Why Tuesday and not Thursday?", at: "2026-10-25T14:01:00-05:00" },
    { id: "chat_2", from: "muse" as const, text: "Class runs until 9 on Thursday.", at: "2026-10-25T14:01:01-05:00", replyTo: "chat_1" },
  ];
  const asked = { ...agreed(), chat };

  it("shows your question on your side, and its answer as an aside from your Muse, both only for you", () => {
    const lines = threadLines(asked, "a").filter((line) => line.id.startsWith("thread-chat-"));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ sender: { kind: "you" }, onlyYou: true, to: "Sprout", text: "Why Tuesday and not Thursday?" });
    expect(lines[1]).toMatchObject({ sender: { kind: "your-muse", name: "Sprout" }, onlyYou: true, text: "Class runs until 9 on Thursday." });
    expect(lines[1].to).toBeUndefined();
  });

  it("puts them where they happened among the Muses' turns", () => {
    const early = { ...asked, chat: chat.map((entry) => ({ ...entry, at: entry.at.replace("14:01", "14:00").replace(":00-05", ":15-05") })) };
    const ids = threadLines(early, "a").map((line) => line.id);
    expect(ids.indexOf("thread-msg_shawarma_002")).toBeLessThan(ids.indexOf("thread-chat-chat_1"));
    expect(ids.indexOf("thread-chat-chat_1")).toBeLessThan(ids.indexOf("thread-msg_shawarma_005"));
  });

  it("never shows a chat on the other phone", () => {
    expect(threadLines(asked, "b").some((line) => line.id.startsWith("thread-chat-"))).toBe(false);
  });

  it("is empty until the first question", () => {
    expect(threadLines({ ...agreed(), chat: [] }, "a").some((line) => line.id.startsWith("thread-chat-"))).toBe(false);
  });
});

describe("runs of the same sender", () => {
  const line = (kind: ThreadLine["sender"]["kind"], name: string): ThreadLine => ({ id: `${kind}-${name}`, sender: { kind, name, owner: "x" }, text: "t" });

  it("show the chip above the first bubble of a run only", () => {
    expect(startsRun(undefined, line("your-muse", "Sprout"))).toBe(true);
    expect(startsRun(line("your-muse", "Sprout"), line("your-muse", "Sprout"))).toBe(false);
    expect(startsRun(line("your-muse", "Sprout"), line("friend-muse", "Mochi"))).toBe(true);
    expect(startsRun(line("friend", "Michelle"), line("friend-muse", "Mochi"))).toBe(true);
  });

  it("put the picture beside the last bubble of a run only", () => {
    expect(endsRun(line("your-muse", "Sprout"), undefined)).toBe(true);
    expect(endsRun(line("your-muse", "Sprout"), line("your-muse", "Sprout"))).toBe(false);
    expect(endsRun(line("your-muse", "Sprout"), line("friend-muse", "Mochi"))).toBe(true);
  });
});
