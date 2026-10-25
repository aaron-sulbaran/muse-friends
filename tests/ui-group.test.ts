import { describe, expect, it } from "vitest";
import type { Decision, MemberId, PlanState, StateSnapshot } from "@/lib/protocol";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { viewForRole, type ChatItem } from "@/lib/ui/chat";
import { namesFor } from "@/lib/ui/format";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import type { Role } from "@/lib/ui/types";

/*
 * A plan for three (Sprout, Mochi, Pebble) as the UI sees it. The snapshot is the pair's fixture for that state plus
 * Pebble's pair thread with the coordinator, the same shape Lane A's group plan has in the store.
 */

const live = { mode: "live" } as const;
const KAI_CONTEXT = "ctx_group_kai";

type Answers = Partial<Record<MemberId, Decision>>;

function groupAt(state: PlanState, answers: Answers = {}): StateSnapshot {
  const pair = snapshotAtPlanState(state);
  const plan = pair.plans.at(-1)!;
  const decisions: Record<MemberId, Decision> = { aaron: "pending", lisa: "pending", kai: "pending", ...answers };
  const pairThread = pair.threads[0];
  const kaiMessages = pair.messages
    .filter((record) => record.message.contextId === plan.contextId)
    .map((record) => ({
      ...record,
      message: {
        ...record.message,
        id: `${record.message.id}_kai`,
        contextId: KAI_CONTEXT,
        from: record.message.from === "lisa" ? ("kai" as const) : ("aaron" as const),
        to: record.message.to === "lisa" ? ("kai" as const) : ("aaron" as const),
      },
    }));
  return {
    ...pair,
    threads: [
      { ...pairThread, groupId: "grp_1" },
      { ...pairThread, contextId: KAI_CONTEXT, groupId: "grp_1", participants: ["aaron", "kai"] as [MemberId, MemberId] },
    ],
    messages: [...pair.messages, ...kaiMessages],
    plans: [
      {
        ...plan,
        decisions: { aaron: decisions.aaron, lisa: decisions.lisa },
        group: {
          groupId: "grp_1",
          coordinator: "aaron",
          members: ["aaron", "lisa", "kai"],
          contexts: { lisa: plan.contextId, kai: KAI_CONTEXT },
          decisions,
          rounds: 2,
          quorum: "all",
        },
      },
    ],
  };
}

const ui = (state: PlanState, answers?: Answers) => toUiSnapshot(groupAt(state, answers), live);
const kinds = (items: ChatItem[]) => items.map((item) => item.kind);
const texts = (items: ChatItem[]) => items.flatMap((item) => (item.kind === "bubble" || item.kind === "collapsed" ? [item.text] : []));

describe("the snapshot of a plan for three", () => {
  it("carries who is in, what each said, and both pair threads", () => {
    const snapshot = ui("awaiting_humans", { aaron: "accepted" });
    expect(snapshot.plan?.group).toMatchObject({
      coordinator: "aaron",
      members: [
        { id: "aaron", decision: "accepted" },
        { id: "lisa", decision: "pending" },
        { id: "kai", decision: "pending" },
      ],
    });
    expect(snapshot.plan?.group?.contextIds).toEqual(expect.arrayContaining(["ctx_group_kai"]));
    expect(snapshot.plan?.group?.contextIds).toHaveLength(2);
  });

  it("names Pebble on the rows that go to and from them", () => {
    const snapshot = ui("awaiting_humans");
    const toPebble = snapshot.messages.filter((message) => message.to === "kai" || message.from === "kai");
    expect(toPebble.length).toBeGreaterThan(0);
    expect(namesFor(snapshot).muse.kai).toBe("Pebble");
    expect(namesFor(snapshot).human.kai).toBe("Pebble");
  });

  it("leaves a pair's plan without a group", () => {
    expect(toUiSnapshot(snapshotAtPlanState("awaiting_humans"), live).plan?.group).toBeNull();
  });
});

describe("who is thinking in a plan for three", () => {
  it("shows both friends at once when both pair threads are working on their answers", () => {
    const state = groupAt("negotiating");
    const first = state.messages.find((record) => record.message.contextId === KAI_CONTEXT)!;
    const mochiThread = state.threads[0];
    state.messages = [
      { ...first, message: { ...first.message, id: "m_a", contextId: mochiThread.contextId, from: "aaron", to: "lisa", seq: 1 } },
      { ...first, message: { ...first.message, id: "m_b", contextId: KAI_CONTEXT, from: "aaron", to: "kai", seq: 1 } },
    ];
    state.threads = state.threads.map((thread) => ({ ...thread, state: "working" as const }));
    const snapshot = toUiSnapshot(state, live);
    expect(snapshot.inFlight?.agents.sort()).toEqual(["kai", "lisa"]);
  });

  it("shows only the coordinator when both friends have answered and Sprout decides next", () => {
    const state = groupAt("negotiating");
    for (const thread of state.threads) {
      thread.state = "working";
      const last = state.messages.filter((record) => record.message.contextId === thread.contextId).at(-1)!;
      last.message.to = "aaron";
      last.message.from = thread.contextId === KAI_CONTEXT ? "kai" : "lisa";
    }
    expect(toUiSnapshot(state, live).inFlight?.agents).toEqual(["aaron"]);
  });

  it("is nobody once every pair thread has agreed", () => {
    expect(ui("awaiting_humans").inFlight).toBeNull();
  });
});

describe("a plan for three on the two phones", () => {
  it("tells the coordinator who is in, and the member who is getting them together", () => {
    const snapshot = ui("awaiting_humans");
    const a = viewForRole(snapshot, "a");
    const b = viewForRole(snapshot, "b");
    expect(texts(a.items).join("\n")).toMatch(/You, Mochi and Pebble all want to try .+, and you're all free/);
    expect(texts(b.items).join("\n")).toMatch(/Sprout is getting Pebble and you together for .+\. You're all free\./);
    expect(a.group).toMatchObject({ coordinator: true, others: [{ name: "Mochi" }, { name: "Pebble" }] });
    expect(b.group).toMatchObject({ coordinator: false, coordinatorName: "Sprout" });
  });

  it("gives each human one card, and Pebble's card only to the coordinator's phone", () => {
    const snapshot = ui("awaiting_humans");
    expect(kinds(viewForRole(snapshot, "a").items)).toEqual(expect.arrayContaining(["plan-card", "member-card"]));
    expect(kinds(viewForRole(snapshot, "b").items)).toContain("plan-card");
    expect(kinds(viewForRole(snapshot, "b").items)).not.toContain("member-card");
    const card = viewForRole(snapshot, "a").items.find((item) => item.kind === "member-card");
    expect(card).toMatchObject({ member: "kai", name: "Pebble" });
  });

  it("waits for whoever is still deciding, and drops Pebble's card once they answer", () => {
    const afterSprout = ui("awaiting_humans", { aaron: "accepted" });
    const a = viewForRole(afterSprout, "a");
    expect(a.status).toEqual({ glyph: "waiting-friend", text: "waiting for Mochi and Pebble" });
    expect(kinds(a.items)).toContain("member-card");
    expect(kinds(a.items)).not.toContain("plan-card");

    const afterPebble = ui("awaiting_humans", { aaron: "accepted", kai: "accepted" });
    const later = viewForRole(afterPebble, "a");
    expect(later.status).toEqual({ glyph: "waiting-friend", text: "waiting for Mochi" });
    expect(kinds(later.items)).not.toContain("member-card");
  });

  it("names everyone on the agreed line and counts every message of both threads", () => {
    const snapshot = ui("awaiting_humans");
    const line = viewForRole(snapshot, "a").items.find((item) => item.kind === "agreed-line");
    expect(line).toMatchObject({ names: ["Sprout", "Mochi", "Pebble"] });
    expect(line && line.kind === "agreed-line" ? line.count : 0).toBe(snapshot.messages.length);
  });

  it("talks to both friends while negotiating, and to Sprout alone from Mochi's side", () => {
    const snapshot = ui("negotiating");
    // With no call running, each phone says who its Muse is talking to.
    const idle = { ...snapshot, inFlight: null };
    expect(viewForRole(idle, "a").status).toEqual({ glyph: "talking", text: "talking to Mochi and Pebble" });
    expect(viewForRole(idle, "b").status).toEqual({ glyph: "talking", text: "talking to Sprout" });
    expect(viewForRole(idle, "a").mood).toBe("talking");
    // While a Muse's own call runs its glyph thinks; the other phones keep talking.
    const mochiThinking = { ...snapshot, inFlight: { agent: "lisa" as const, agents: ["lisa" as const] } };
    expect(viewForRole(mochiThinking, "b").status).toEqual({ glyph: "thinking", text: "thinking it over" });
    expect(viewForRole(mochiThinking, "a").status).toEqual({ glyph: "talking", text: "talking to Mochi and Pebble" });
  });

  it("holds the time with both others once it is confirmed", () => {
    const view = viewForRole(ui("scheduled", { aaron: "accepted", lisa: "accepted", kai: "accepted" }), "a");
    expect(texts(view.items).join("\n")).toContain("Mochi and Pebble are in");
    const hold = view.items.find((item) => item.kind === "hold-row");
    expect(hold).toMatchObject({ title: expect.stringMatching(/ with Mochi and Pebble$/) });
  });

  it("says who passed when a plan for three is dropped", () => {
    const state = groupAt("awaiting_humans", { aaron: "accepted", kai: "declined" });
    const plan = state.plans[0];
    plan.state = "dropped";
    plan.history = [...plan.history, { state: "dropped", at: plan.updatedAt }];
    const snapshot = toUiSnapshot(state, live);
    expect(texts(viewForRole(snapshot, "a").items)).toContain("Pebble said not now.");
    expect(texts(viewForRole(snapshot, "b").items)).toContain("Pebble said not now.");
  });

  it("keeps a pair's phones exactly as they were", () => {
    const pair = toUiSnapshot(snapshotAtPlanState("awaiting_humans"), live);
    for (const role of ["a", "b"] as Role[]) {
      const view = viewForRole(pair, role);
      expect(view.group).toBeNull();
      expect(kinds(view.items)).not.toContain("member-card");
    }
  });
});
