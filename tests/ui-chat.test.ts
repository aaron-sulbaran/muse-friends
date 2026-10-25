import { describe, expect, it } from "vitest";
import { PLAN_STATES, type PlanState, type StateSnapshot } from "@/lib/protocol";
import { recordedSnapshot, seedSnapshot } from "@/lib/seed/fixtures";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { copy } from "@/lib/ui/copy";
import { onboardingItems, viewForRole, type ChatItem } from "@/lib/ui/chat";
import { initialOnboarding, reduceOnboarding, type OnboardingAction } from "@/lib/ui/onboarding";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import type { Role } from "@/lib/ui/types";

const live = { mode: "live" } as const;

function at(state: PlanState) {
  return toUiSnapshot(snapshotAtPlanState(state), live);
}

/** The negotiating fixture has a call in flight; between calls neither Muse is thinking, which is when the glyph says talking. */
function quietNegotiation() {
  return { ...at("negotiating"), inFlight: null };
}

function kinds(items: ChatItem[]) {
  return items.map((item) => item.kind);
}

describe("every plan state renders on both phones", () => {
  for (const state of PLAN_STATES) {
    it(`${state}: no internal ids, a status or none, and no agent chatter`, () => {
      for (const role of ["a", "b"] as Role[]) {
        const view = viewForRole(at(state), role);
        const text = JSON.stringify(view);
        expect(text).not.toMatch(/Aaron|Lisa/);
        expect(text).not.toContain('"intent"');
        expect(view.items.length).toBeGreaterThan(0);
      }
    });
  }
});

describe("how a judge starts", () => {
  const empty = () => toUiSnapshot(seedSnapshot(), live);

  it("side b can send the reel, and side a can bring in the simulated friend", () => {
    expect(viewForRole(empty(), "b").items.find((item) => item.kind === "start-card")).toMatchObject({ variant: "send-reel", friendName: "Sprout" });
    expect(viewForRole(empty(), "a").items.find((item) => item.kind === "start-card")).toMatchObject({ variant: "simulated-friend" });
  });

  it("with Michelle already on, Sprout's one tap is checking with her; with her off it is bringing her in", () => {
    const state = seedSnapshot();
    state.room = { ...state.room, simulatedFriend: true };
    const withMichelle = toUiSnapshot(state, live);
    expect(viewForRole(withMichelle, "a").items.find((item) => item.kind === "start-card")).toMatchObject({ variant: "send-reel", friendName: "Michelle" });
    expect(viewForRole(empty(), "a").items.find((item) => item.kind === "start-card")).toMatchObject({ variant: "simulated-friend" });
  });

  it("with a simulated friend, side b has nothing to tap: she sends the reel herself", () => {
    const state = seedSnapshot();
    state.room = { ...state.room, simulatedFriend: true };
    const snapshot = toUiSnapshot(state, live);
    expect(kinds(viewForRole(snapshot, "b").items)).not.toContain("start-card");
    expect(viewForRole(snapshot, "b").museName).toBe("Mochi");
  });

  it("once a plan exists, nobody is offered a start", () => {
    for (const role of ["a", "b"] as Role[]) expect(kinds(viewForRole(at("detected"), role).items)).not.toContain("start-card");
  });
});

describe("what the header avatar is doing", () => {
  it("reads the reel and negotiates as thinking, then talking, and rests while a person decides", () => {
    expect(viewForRole(at("detected"), "a").mood).toBe("thinking");
    expect(viewForRole(at("detected"), "b").mood).toBe("idle");
    const between = { ...at("negotiating"), inFlight: null };
    expect(viewForRole(between, "a").mood).toBe("talking");
    expect(viewForRole(between, "b").mood).toBe("talking");
    expect(viewForRole(at("awaiting_humans"), "a").mood).toBe("idle");
    expect(viewForRole(at("scheduled"), "b").mood).toBe("idle");
  });

  it("thinks while its own model call is in flight, and only that Muse does", () => {
    const inFlight = { ...at("negotiating"), inFlight: { agent: "aaron" as const, agents: ["aaron" as const] } };
    expect(viewForRole(inFlight, "a").mood).toBe("thinking");
    expect(viewForRole(inFlight, "b").mood).toBe("talking");
  });

  it("rests when a turn failed, and before any plan", () => {
    expect(viewForRole(toUiSnapshot(seedSnapshot(), live), "a").mood).toBe("idle");
    const failed = { ...at("negotiating"), failure: { agent: "aaron" as const }, inFlight: null };
    expect(viewForRole(failed, "a").mood).toBe("idle");
  });
});

describe("the journey, phone by phone", () => {
  it("reading the reel, then talking, are status lines and nothing else in the chat", () => {
    expect(viewForRole(at("detected"), "a").status).toEqual({ glyph: "reading", text: "reading your friend's reel" });
    expect(viewForRole(quietNegotiation(), "a").status).toEqual({ glyph: "talking", text: "talking to Mochi" });
    expect(viewForRole(quietNegotiation(), "b").status).toEqual({ glyph: "talking", text: "talking to Sprout" });
    expect(kinds(viewForRole(at("negotiating"), "a").items)).not.toContain("plan-card");
  });

  it("both agents agreed: one proposal bubble and one live card on each phone", () => {
    for (const role of ["a", "b"] as Role[]) {
      const view = viewForRole(at("awaiting_humans"), role);
      expect(view.items.filter((item) => item.kind === "plan-card")).toHaveLength(1);
      expect(view.status).toEqual({ glyph: "waiting-you", text: "waiting for you" });
    }
    const bubble = viewForRole(at("awaiting_humans"), "a").items.find((item) => item.kind === "bubble" && item.id === "proposal");
    expect(bubble).toMatchObject({ text: "You both want to try Shawarma Point, and you're both free Tuesday 6 to 8." });
  });

  it("collapses a card to a line after that person's yes, and waits for the other", () => {
    const state = snapshotAtPlanState("awaiting_humans");
    state.plans[0].decisions.aaron = "accepted";
    const snapshot = toUiSnapshot(state, live);
    const a = viewForRole(snapshot, "a");
    expect(kinds(a.items)).toContain("collapsed");
    expect(kinds(a.items)).not.toContain("plan-card");
    expect(a.status).toEqual({ glyph: "waiting-friend", text: "waiting for your friend" });
    expect(kinds(viewForRole(snapshot, "b").items)).toContain("plan-card");
  });

  it("gives only the initiator the draft card; the friend is told it is coming", () => {
    const confirmed = at("confirmed");
    expect(kinds(viewForRole(confirmed, "a").items)).toContain("draft-card");
    expect(kinds(viewForRole(confirmed, "b").items)).not.toContain("draft-card");
  });

  it("scheduled adds the hold row to both phones", () => {
    for (const role of ["a", "b"] as Role[]) expect(kinds(viewForRole(at("scheduled"), role).items)).toContain("hold-row");
  });

  it("the hold row offers a prefilled Google Calendar event naming the other person, in UTC, with the place", () => {
    const row = viewForRole(at("scheduled"), "a").items.find((item) => item.kind === "hold-row");
    const url = new URL(row && row.kind === "hold-row" && row.googleUrl ? row.googleUrl : "");
    expect(url.searchParams.get("text")).toBe("Shawarma Point with your friend");
    expect(url.searchParams.get("dates")).toBe("20261027T230000Z/20261028T010000Z");
    expect(url.searchParams.get("details")).toBe("Sprout and Mochi planned this in Muse Friends.");
    expect(url.searchParams.get("location")).toBe("E 6th St, Austin");
    const other = viewForRole(at("scheduled"), "b").items.find((item) => item.kind === "hold-row");
    expect(new URL(other && other.kind === "hold-row" && other.googleUrl ? other.googleUrl : "").searchParams.get("text")).toBe("Shawarma Point with your friend");
  });

  it("the Google Calendar link never carries a place that was withheld", () => {
    const state = snapshotAtPlanState("scheduled");
    state.redactions.push({ id: "red_x", contextId: state.threads[0].contextId, messageId: state.messages[1].message.id, from: "lisa", to: "aaron", removed: ["location"], detail: "Location removed.", at: state.clock.now });
    const row = viewForRole(toUiSnapshot(state, live), "a").items.find((item) => item.kind === "hold-row");
    const url = new URL(row && row.kind === "hold-row" && row.googleUrl ? row.googleUrl : "");
    expect(url.searchParams.has("location")).toBe(false);
  });

  it("reminded and followed up add a day separator and the Muse's line", () => {
    const reminded = viewForRole(at("reminded"), "a").items;
    expect(reminded.some((item) => item.kind === "bubble" && item.text.startsWith("Shawarma Point with your friend at 6"))).toBe(true);
    const followed = viewForRole(at("followed_up"), "a").items;
    expect(followed.some((item) => item.kind === "bubble" && item.text === "Did you two make it?")).toBe(true);
    // The recording counted the hangout, so the answer shows and the next idea comes from another shared signal.
    expect(followed.find((item) => item.id === "outcome-answer")).toMatchObject({ text: "We went!" });
    const next = followed.find((item) => item.id === "next-idea");
    expect(next?.kind === "bubble" && !next.text.includes("Shawarma")).toBe(true);
  });

  it("opens on the stale chat: last week's reel card under Last Saturday, then Muse picks it up today", () => {
    const items = viewForRole(at("detected"), "a").items;
    const reel = items.findIndex((item) => item.kind === "reel-card" && item.place === "Shawarma Point");
    const lastWeek = items.findIndex((item) => item.kind === "separator" && item.day.startsWith("Last "));
    const today = items.findIndex((item) => item.kind === "separator" && item.day === "Today");
    expect(lastWeek).toBeGreaterThan(-1);
    expect(reel).toBeGreaterThan(lastWeek);
    expect(today).toBeGreaterThan(reel);
    expect(items[today + 1]).toMatchObject({ kind: "bubble", from: "muse", text: "Your friend sent you this a week ago. Want me to see if you two can make it happen?" });
  });

  it("a friend's no reads neutrally on each side", () => {
    const a = viewForRole(at("dropped"), "a").items.find((item) => item.kind === "bubble" && item.id === "dropped");
    const b = viewForRole(at("dropped"), "b").items.find((item) => item.kind === "bubble" && item.id === "dropped");
    expect(a).toMatchObject({ text: "Your friend said not now." });
    expect(b).toMatchObject({ text: "You said not now" });
  });
});

describe("follow-through counts one thing: plans that happened", () => {
  it("reads 0 on the dead reel and every state before the plan took place", () => {
    for (const state of ["detected", "negotiating", "awaiting_humans", "confirmed", "scheduled", "reminded"] as PlanState[]) {
      expect(at(state).followThrough.events).toHaveLength(0);
    }
  });

  it("reads 1 once it happened, and stays 1 after the follow-up", () => {
    for (const state of ["happened", "followed_up"] as PlanState[]) {
      expect(at(state).followThrough.events.map((event) => event.label)).toEqual(["Sprout and Mochi got shawarma together"]);
    }
  });

  it("lists taps and sends separately and never counts agent messages", () => {
    const snapshot = at("confirmed");
    expect(snapshot.followThrough.humanTapCount).toBe(3);
    expect(snapshot.followThrough.agentMessageCount).toBe(6);
    expect(snapshot.followThrough.events).toHaveLength(0);
  });
});

describe("what the store can say that the recorded states do not", () => {
  it("withholds the place once a redaction removed location, even if the plan still names it", () => {
    const state: StateSnapshot = recordedSnapshot();
    expect(toUiSnapshot(state, live).plan?.place).toBe("E 6th St, Austin");
    state.redactions.push({
      id: "red_1",
      contextId: state.threads[0].contextId,
      messageId: state.messages[1].message.id,
      from: "lisa",
      to: "aaron",
      removed: ["location"],
      detail: "Location removed under the new setting.",
      at: state.clock.now,
    });
    expect(toUiSnapshot(state, live).plan?.place).toBeNull();
  });

  it("maps model proof onto the row", () => {
    const state = recordedSnapshot();
    state.messages[0].proof = { model: "muse-spark-1.3", responseId: "resp_1", latencyMs: 1234, inputTokens: 500, outputTokens: 140, reasoningTokens: 90 };
    expect(toUiSnapshot(state, live).messages[0].proof).toEqual(state.messages[0].proof);
    expect(toUiSnapshot(recordedSnapshot(), live).messages[0].proof).toBeUndefined();
  });

  it("a turn that produced no message shows the failure: status, row, and an honest bubble", () => {
    const state = recordedSnapshot();
    state.threads[0] = { ...state.threads[0], state: "failed", dropReason: "cap_reached" };
    state.plans[0] = { ...state.plans[0], state: "dropped", dropReason: "cap_reached" };
    state.events.push({ id: "evt_fail", at: state.clock.now, kind: "turn_failed", actor: "system", agent: "lisa", contextId: state.threads[0].contextId, text: "Mochi's turn ended without a message" });
    const snapshot = toUiSnapshot(state, live);
    expect(snapshot.failure).toEqual({ agent: "lisa" });
    expect(snapshot.plan?.droppedReason).toBe("A model call failed");
    const view = viewForRole(snapshot, "a");
    expect(view.status).toEqual({ glyph: "retrying", text: "having trouble reaching Mochi" });
    expect(view.items.find((item) => item.kind === "bubble" && item.id === "dropped")).toMatchObject({ text: "Mochi didn't answer, so this plan stopped." });
  });

  it("labels the simulated friend when the room says so", () => {
    const state = recordedSnapshot();
    state.room = { ...state.room, simulatedFriend: true };
    const snapshot = toUiSnapshot(state, live);
    expect(snapshot.simulatedFriend).toBe(true);
    expect(viewForRole(snapshot, "b").museName).toBe("Mochi");
    expect(viewForRole(snapshot, "a").friendHumanName).toBe("Michelle");
  });
});

describe("the status glyph follows what the Muse is doing", () => {
  it("thinks while its own call runs during a negotiation, and talks while it waits", () => {
    const thinkingA = { ...at("negotiating"), inFlight: { agent: "aaron" as const, agents: ["aaron" as const] } };
    expect(viewForRole(thinkingA, "a").status).toEqual({ glyph: "thinking", text: "thinking it over" });
    expect(viewForRole(thinkingA, "b").status).toEqual({ glyph: "talking", text: "talking to Sprout" });
    expect(viewForRole(thinkingA, "a").mood).toBe("thinking");
  });

  it("says sent once a plan is confirmed, and nothing for the later states", () => {
    expect(viewForRole(at("confirmed"), "a").status).toEqual({ glyph: "done", text: "sent" });
    expect(viewForRole(at("scheduled"), "a").status).toBeNull();
  });

  it("has no emoji in any status line, in any state, on either phone", () => {
    const emoji = /\p{Extended_Pictographic}/u;
    for (const state of PLAN_STATES) {
      for (const role of ["a", "b"] as Role[]) {
        const status = viewForRole(at(state), role).status;
        expect(status === null || !emoji.test(status.text)).toBe(true);
      }
    }
  });
});

describe("the app's own lines carry no emoji", () => {
  const emoji = /\p{Extended_Pictographic}/u;
  const everyLine = (snapshot: ReturnType<typeof at>) =>
    (["a", "b"] as Role[]).flatMap((role) => viewForRole(snapshot, role).items.flatMap((item) => (item.kind === "bubble" || item.kind === "collapsed" ? [item.text] : [])));

  it("in the seeded history on both phones", () => {
    const lines = everyLine(at("awaiting_humans"));
    expect(lines.some((line) => /sent you a reel/.test(line))).toBe(true);
    expect(lines.some((line) => /Cedar Bluff Trail/.test(line))).toBe(true);
    for (const line of lines) expect(line).not.toMatch(emoji);
  });

  it("in the reply after a plan happens, and in the nudge", () => {
    expect(copy.outcomeWentReply).not.toMatch(emoji);
    expect(copy.nudgeSent("Michelle")).not.toMatch(emoji);
  });
});

describe("Michelle's own phone names her Muse Mochi", () => {
  it("in the pill and the line under the plan card, while Sprout's phone says Michelle's Muse", () => {
    const state = snapshotAtPlanState("awaiting_humans");
    state.room = { ...state.room, simulatedFriend: true };
    const snapshot = toUiSnapshot(state, live);
    expect(viewForRole(snapshot, "b").museName).toBe("Mochi");
    expect(viewForRole(snapshot, "b").humanName).toBe("Michelle");
    expect(viewForRole(snapshot, "a").friendMuseName).toBe("Michelle's Muse");
    const agreed = viewForRole(snapshot, "b").items.find((item) => item.kind === "agreed-line");
    expect(agreed && agreed.kind === "agreed-line" ? agreed.names[0] : null).toBe("Mochi");
  });
});

describe("the thread in the chat", () => {
  const lines = (items: ChatItem[]) => items.flatMap((item) => (item.kind === "thread-line" ? [item.line] : []));

  it("lands the Muses' turns before the offer, and nothing else before it", () => {
    const items = viewForRole(at("awaiting_humans"), "a").items;
    const ids = items.map((item) => item.id);
    expect(lines(items).filter((line) => line.phase === "talk").length).toBeGreaterThan(0);
    const lastTalk = Math.max(...items.flatMap((item, index) => (item.kind === "thread-line" && item.line.phase === "talk" ? [index] : [])));
    expect(lastTalk).toBeLessThan(ids.indexOf("proposal"));
  });

  it("shows the turns live while the Muses negotiate, so a judge watches them talk", () => {
    expect(lines(viewForRole(quietNegotiation(), "a").items).length).toBeGreaterThan(0);
  });

  it("keeps every card and the agreed line where they were", () => {
    const kindsAfter = kinds(viewForRole(at("awaiting_humans"), "a").items);
    expect(kindsAfter).toContain("plan-card");
    expect(kindsAfter).toContain("agreed-line");
  });

  it("never gives Michelle a scripted yes before the person has sent anything, nor for a friend who is not played", () => {
    const base = at("awaiting_humans");
    const accepted = { ...base, simulatedFriend: true, plan: { ...base.plan!, decisions: { a: "accepted" as const, b: "accepted" as const } } };
    expect(lines(viewForRole(accepted, "a").items).some((line) => line.sender.kind === "friend")).toBe(false);
    const sent = { ...at("scheduled"), simulatedFriend: false, plan: { ...at("scheduled").plan!, decisions: { a: "accepted" as const, b: "accepted" as const } } };
    expect(lines(viewForRole(sent, "a").items).some((line) => line.sender.kind === "friend")).toBe(false);
  });

  it("gives every item a distinct id", () => {
    for (const role of ["a", "b"] as Role[]) {
      const ids = viewForRole(at("awaiting_humans"), role).items.map((item) => item.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("the order the person is asked in (what comes after what)", () => {
  const lines = (items: ChatItem[]) => items.flatMap((item) => (item.kind === "thread-line" ? [item.line] : []));
  const ids = (items: ChatItem[]) => items.map((item) => item.id);
  const withMichelle = (state: PlanState, decision: "accepted" | "declined" = "accepted") => {
    const base = at(state);
    return { ...base, simulatedFriend: true, plan: { ...base.plan!, decisions: { a: "accepted" as const, b: decision } } };
  };

  it("holds her yes until the message is handed off: a confirmed plan has no reply yet", () => {
    expect(ids(viewForRole(withMichelle("confirmed"), "a").items)).not.toContain("thread-friend-accepted");
  });

  it("draws her yes right after the draft, as the reply to what the person just sent, and the hold after it", () => {
    const order = ids(viewForRole(withMichelle("scheduled"), "a", { friendReplied: true }).items);
    expect(order.indexOf("draft-intro")).toBeGreaterThan(-1);
    expect(order.indexOf("thread-friend-accepted")).toBeGreaterThan(order.indexOf("draft-intro"));
    expect(order.indexOf("hold-bubble")).toBeGreaterThan(order.indexOf("thread-friend-accepted"));
    expect(order.indexOf("hold-row")).toBeGreaterThan(order.indexOf("hold-bubble"));
  });

  it("leaves the hold and the calendar row undrawn while her reply is on its way, though the server has the hold", () => {
    const view = viewForRole(withMichelle("scheduled"), "a", { friendReplied: false });
    for (const id of ["thread-friend-accepted", "hold-bubble", "hold-row"]) expect(ids(view.items)).not.toContain(id);
    expect(withMichelle("scheduled").plan.history.some((entry) => entry.state === "scheduled")).toBe(true);
  });

  it("does not hold the calendar back for a friend nobody plays", () => {
    const real = { ...withMichelle("scheduled"), simulatedFriend: false };
    expect(ids(viewForRole(real, "a", { friendReplied: false }).items)).toEqual(expect.arrayContaining(["hold-bubble", "hold-row"]));
  });

  it("keeps her yes out of the block at the end, and her no where the plan dropped", () => {
    for (const state of ["scheduled", "reminded", "followed_up"] as const) {
      const order = ids(viewForRole(withMichelle(state), "a", { friendReplied: true }).items);
      expect(order.indexOf("thread-friend-accepted")).toBeLessThan(order.indexOf(state === "scheduled" ? "hold-row" : "sep-reminded"));
    }
    const dropped = lines(viewForRole(withMichelle("dropped", "declined"), "a").items).find((line) => line.sender.kind === "friend");
    expect(dropped).toMatchObject({ text: "Not this time, sorry.", phase: "after" });
  });

  it("never leaves two cards with buttons open at once once the plan has run its course", () => {
    const open = ["plan-card", "draft-card", "settle-card", "outcome-replies"];
    for (const state of ["awaiting_humans", "confirmed", "scheduled", "reminded", "followed_up"] as const) {
      const cards = viewForRole(withMichelle(state), "a", { friendReplied: true }).items.filter((item) => open.includes(item.kind));
      const decisions = cards.filter((item) => item.kind === "plan-card" || item.kind === "settle-card");
      expect(decisions.length).toBeLessThanOrEqual(1);
    }
  });
});

describe("the onboarding in the chat", () => {
  const after = (...actions: OnboardingAction[]) => actions.reduce(reduceOnboarding, initialOnboarding());
  const bubbles = (items: ChatItem[]) => items.flatMap((item) => (item.kind === "bubble" ? [{ from: item.from, text: item.text }] : []));

  it("opens with Sprout's greeting and the Friends card", () => {
    const items = onboardingItems(initialOnboarding(), "Michelle");
    expect(kinds(items)).toEqual(["bubble", "onboarding-friends"]);
    expect(bubbles(items)).toEqual([{ from: "muse", text: "Hi, I'm Sprout, your Muse." }]);
  });

  it("answers the card with the judge's own choice once Friends is on, and the card is gone", () => {
    for (const state of [after({ type: "friendsOn" }), after({ type: "friendsOn" }, { type: "sync" }, { type: "continue" }), after({ type: "friendsOn" }, { type: "sync" }, { type: "continue" }, { type: "done" })]) {
      const items = onboardingItems(state, "Michelle");
      expect(kinds(items)).toEqual(["bubble", "bubble"]);
      expect(bubbles(items)[1]).toEqual({ from: "user", text: "Turn on Friends" });
    }
  });

  it("after Not now shows the opt-out card, then says that planning needs Friends and offers one pill", () => {
    const items = onboardingItems(after({ type: "notNow" }), "Michelle");
    expect(kinds(items)).toEqual(["bubble", "bubble", "onboarding-optout", "bubble", "onboarding-turn-on"]);
    expect(bubbles(items)).toEqual([
      { from: "muse", text: "Hi, I'm Sprout, your Muse." },
      { from: "user", text: "Not now" },
      { from: "muse", text: "Want to plan this with Michelle? That needs Friends." },
    ]);
  });

  it("treats a Continue with everyone at Off as the opt-out, naming the room's friend", () => {
    const items = onboardingItems(after({ type: "friendsOn" }, { type: "pick" }, { type: "continue" }), "Priya");
    expect(kinds(items)).toContain("onboarding-optout");
    expect(bubbles(items).at(-1)?.text).toBe("Want to plan this with Priya? That needs Friends.");
  });

  it("gives every item a distinct id, so the chat can key them", () => {
    const items = onboardingItems(after({ type: "notNow" }), "Michelle");
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
  });
});
