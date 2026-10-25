import type {
  Category,
  Decision,
  FollowThroughEvent,
  PlanState,
  Role,
  UiMessage,
  UiPlan,
  UiSnapshot,
} from "./types";

/*
 * Lane B's own recorded run of the shawarma thread. It exists so the UI can be
 * built and clicked through before Lane A's store and seed fixtures land; when
 * lib/seed/fixtures.ts is merged, lib/ui/source.ts reads that instead and this
 * file is deleted. Times are Central: Sat Oct 24 for the thread, Tue Oct 27
 * 6 to 8 PM for the plan.
 */

const threadId = "ctx-shawarma-01";
const planId = "plan-shawarma-01";

const at = {
  reelReceived: "2026-10-25T01:41:48Z", // Sat 8:41:48 PM
  intent: "2026-10-25T01:42:10Z",
  propose: "2026-10-25T01:42:19Z",
  counter: "2026-10-25T01:42:31Z",
  accept: "2026-10-25T01:42:40Z",
  beforeNow: "2026-10-25T01:40:00Z", // Sat 8:40 PM
  afterNow: "2026-10-25T01:44:00Z", // Sat 8:44 PM
  reminded: "2026-10-27T22:00:00Z", // Tue 5:00 PM
  happened: "2026-10-28T01:00:00Z", // Tue 8:00 PM
  followedUp: "2026-10-28T15:00:00Z", // Wed 10:00 AM
} as const;

const tuesdayWindow = { start: "2026-10-27T23:00:00Z", end: "2026-10-28T01:00:00Z" };
const thursdayWindow = { start: "2026-10-30T00:00:00Z", end: "2026-10-30T02:00:00Z" };

export const fixtureDraft = "hey! that shawarma place from your reel, tuesday 6 to 8?";
export const fixturePlace = "East 6th St";

export type FixtureState = {
  reelLoaded: boolean;
  /** How many of the four thread messages have arrived. */
  messagesShown: 0 | 1 | 2 | 3 | 4;
  decisions: Record<Role, Decision>;
  /** True once a human took the draft to WhatsApp (opened it or copied it). */
  handoff: boolean;
  /** 0 is Saturday night; 1 jumps to the Tuesday reminder; 2 jumps to the next day. */
  clockStage: 0 | 1 | 2;
  simulatedFriend: boolean;
  locationShared: boolean;
  mode: "live" | "replay";
  /** Wall-clock ISO of the last step, used for the elapsed counter on the thinking row. */
  steppedAt: string;
};

export type FixtureAction =
  | { type: "load_reel" }
  | { type: "next_message" }
  | { type: "decide"; role: Role; choice: "accept" | "decline" }
  | { type: "handoff" }
  | { type: "clock_next" }
  | { type: "set_location"; shared: boolean }
  | { type: "set_simulated"; value: boolean }
  | { type: "set_mode"; mode: "live" | "replay" }
  | { type: "reset" };

export function initialFixtureState(): FixtureState {
  return {
    reelLoaded: false,
    messagesShown: 0,
    decisions: { a: "pending", b: "pending" },
    handoff: false,
    clockStage: 0,
    simulatedFriend: false,
    locationShared: true,
    mode: "live",
    steppedAt: new Date().toISOString(),
  };
}

export function reduceFixture(state: FixtureState, action: FixtureAction): FixtureState {
  const stamped = (next: FixtureState): FixtureState => ({ ...next, steppedAt: new Date().toISOString() });
  switch (action.type) {
    case "load_reel":
      return stamped({ ...state, reelLoaded: true });
    case "next_message": {
      if (!state.reelLoaded) return stamped({ ...state, reelLoaded: true });
      if (state.messagesShown >= 4) return state;
      return stamped({ ...state, messagesShown: (state.messagesShown + 1) as FixtureState["messagesShown"] });
    }
    case "decide": {
      if (derivePlanState(state) !== "awaiting_humans") return state;
      const decision: Decision = action.choice === "accept" ? "accepted" : "declined";
      return stamped({ ...state, decisions: { ...state.decisions, [action.role]: decision } });
    }
    case "handoff":
      if (derivePlanState(state) !== "confirmed") return state;
      return stamped({ ...state, handoff: true });
    case "clock_next": {
      const stage = derivePlanState(state);
      if (state.clockStage === 0 && (stage === "scheduled" || stage === "confirmed")) {
        return stamped({ ...state, handoff: true, clockStage: 1 });
      }
      if (state.clockStage === 1) return stamped({ ...state, clockStage: 2 });
      return state;
    }
    case "set_location":
      return stamped({ ...state, locationShared: action.shared });
    case "set_simulated":
      return stamped({ ...state, simulatedFriend: action.value });
    case "set_mode":
      return stamped({ ...state, mode: action.mode });
    case "reset":
      return initialFixtureState();
  }
}

export function derivePlanState(state: FixtureState): PlanState | null {
  if (!state.reelLoaded) return null;
  if (state.decisions.a === "declined" || state.decisions.b === "declined") return "dropped";
  if (state.messagesShown === 0) return "detected";
  if (state.messagesShown < 4) return "negotiating";
  const bothYes = state.decisions.a === "accepted" && state.decisions.b === "accepted";
  if (!bothYes) return "awaiting_humans";
  if (!state.handoff) return "confirmed";
  if (state.clockStage === 0) return "scheduled";
  if (state.clockStage === 1) return "reminded";
  return "followed_up";
}

function buildMessages(state: FixtureState): UiMessage[] {
  const placeShared = state.locationShared;
  const proofFor = (n: number) => ({
    model: "muse-spark-1.3",
    responseId: `resp_recorded_${n}`,
    latencyMs: [1200, 1400, 1100, 900][n - 1] ?? 1000,
    totalTokens: [640, 812, 590, 455][n - 1] ?? 500,
  });

  const all: UiMessage[] = [
    {
      id: "msg-1",
      contextId: threadId,
      seq: 1,
      from: "aaron",
      to: "lisa",
      type: "intent",
      state: "working",
      activity: { title: "the shawarma place" },
      reason: "interest_match",
      shared: ["food"],
      removed: [],
      at: at.intent,
      proof: proofFor(1),
      raw: {
        id: "msg-1",
        contextId: threadId,
        seq: 1,
        from: "aaron",
        to: "lisa",
        type: "intent",
        state: "working",
        activity: { kind: "food", title: "Shawarma place from Lisa's reel" },
        reason: "interest_match",
        shared: { food: "shawarma" },
        at: at.intent,
      },
    },
    {
      id: "msg-2",
      contextId: threadId,
      seq: 2,
      from: "lisa",
      to: "aaron",
      type: "propose",
      state: "working",
      activity: { title: "the shawarma place", ...(placeShared ? { place: fixturePlace } : {}) },
      windows: [tuesdayWindow, thursdayWindow],
      reason: "both_free",
      note: "Weeknights work best.",
      shared: placeShared ? ["food", "location"] : ["food"],
      removed: placeShared ? [] : ["location"],
      at: at.propose,
      proof: proofFor(2),
      raw: {
        id: "msg-2",
        contextId: threadId,
        seq: 2,
        from: "lisa",
        to: "aaron",
        type: "propose",
        state: "working",
        activity: { kind: "food", title: "Shawarma place from Lisa's reel", ...(placeShared ? { place: fixturePlace } : {}) },
        windows: [tuesdayWindow, thursdayWindow],
        reason: "both_free",
        note: "Weeknights work best.",
        shared: placeShared ? { food: "shawarma", location: "East 6th St" } : { food: "shawarma" },
        at: at.propose,
      },
    },
    {
      id: "msg-3",
      contextId: threadId,
      seq: 3,
      from: "aaron",
      to: "lisa",
      type: "counter",
      state: "working",
      activity: { title: "the shawarma place" },
      windows: [tuesdayWindow],
      reason: "both_free",
      note: "Tuesday works for me.",
      shared: [],
      removed: [],
      at: at.counter,
      proof: proofFor(3),
      raw: {
        id: "msg-3",
        contextId: threadId,
        seq: 3,
        from: "aaron",
        to: "lisa",
        type: "counter",
        state: "working",
        windows: [tuesdayWindow],
        reason: "both_free",
        note: "Tuesday works for me.",
        at: at.counter,
      },
    },
    {
      id: "msg-4",
      contextId: threadId,
      seq: 4,
      from: "lisa",
      to: "aaron",
      type: "accept",
      state: "input-required",
      activity: { title: "the shawarma place" },
      windows: [tuesdayWindow],
      reason: "both_free",
      shared: [],
      removed: [],
      at: at.accept,
      proof: proofFor(4),
      raw: {
        id: "msg-4",
        contextId: threadId,
        seq: 4,
        from: "lisa",
        to: "aaron",
        type: "accept",
        state: "input-required",
        windows: [tuesdayWindow],
        reason: "both_free",
        at: at.accept,
      },
    },
  ];
  return all.slice(0, state.messagesShown);
}

function buildHistory(state: FixtureState, planState: PlanState): UiPlan["history"] {
  const history: UiPlan["history"] = [{ state: "detected", at: at.reelReceived }];
  if (state.messagesShown >= 1) history.push({ state: "negotiating", at: at.intent });
  if (state.messagesShown >= 4) history.push({ state: "awaiting_humans", at: at.accept });
  const confirmedAt = at.afterNow;
  if (["confirmed", "scheduled", "reminded", "followed_up"].includes(planState)) {
    history.push({ state: "confirmed", at: confirmedAt });
  }
  if (["scheduled", "reminded", "followed_up"].includes(planState)) history.push({ state: "scheduled", at: confirmedAt });
  if (["reminded", "followed_up"].includes(planState)) history.push({ state: "reminded", at: at.reminded });
  if (planState === "followed_up") {
    history.push({ state: "happened", at: at.happened });
    history.push({ state: "followed_up", at: at.followedUp });
  }
  if (planState === "dropped") history.push({ state: "dropped", at: at.afterNow });
  return history;
}

function buildFollowThrough(state: FixtureState): FollowThroughEvent[] {
  const events: FollowThroughEvent[] = [];
  if (state.decisions.a === "accepted") events.push({ id: "ft-a-yes", label: "Aaron said yes", at: at.afterNow });
  if (state.decisions.b === "accepted") {
    const name = state.simulatedFriend ? "Michelle" : "Lisa";
    events.push({ id: "ft-b-yes", label: `${name} said yes`, at: at.afterNow });
  }
  if (state.handoff) events.push({ id: "ft-handoff", label: "Aaron took the draft to WhatsApp", at: at.afterNow });
  if (state.clockStage === 2) events.push({ id: "ft-showed", label: "Showed up (simulated clock)", at: at.happened });
  return events;
}

export function buildFixtureSnapshot(state: FixtureState): UiSnapshot {
  const planState = derivePlanState(state);
  const messages = buildMessages(state);
  const clockNow =
    state.clockStage === 2 ? at.followedUp : state.clockStage === 1 ? at.reminded : state.reelLoaded ? at.afterNow : at.beforeNow;

  const plan: UiPlan | null =
    planState === null
      ? null
      : {
          id: planId,
          contextId: threadId,
          state: planState,
          activityTitle: "Shawarma place",
          place: state.locationShared ? fixturePlace : null,
          window: state.messagesShown >= 4 ? tuesdayWindow : null,
          decisions: state.decisions,
          draft: planState === "confirmed" || planState === "scheduled" || planState === "reminded" || planState === "followed_up" ? fixtureDraft : null,
          droppedReason:
            planState === "dropped"
              ? state.decisions.b === "declined"
                ? "Declined by the other person"
                : "Declined by you"
              : null,
          history: buildHistory(state, planState),
        };

  const thinking = state.reelLoaded && state.messagesShown >= 1 && state.messagesShown < 4;
  const lastMessage = messages[messages.length - 1];

  return {
    now: clockNow,
    clockSimulated: state.clockStage > 0,
    mode: state.mode,
    simulatedFriend: state.simulatedFriend,
    messages,
    plan,
    followThrough: { events: buildFollowThrough(state), agentMessageCount: messages.length },
    inFlight: thinking && lastMessage ? { agent: lastMessage.to, since: state.steppedAt } : null,
    lisaSharesWithAaron: {
      tier: "friend",
      categories: {
        food: true,
        events: true,
        availability: true,
        location: state.locationShared,
        interests: true,
      } satisfies Record<Category, boolean>,
    },
  };
}
