import { z } from "zod";
import { SEEDED_FRIEND_IDS, SEEDED_FRIENDS } from "@/lib/seed/friends";
import { FEELS_MAX, type FreeChipId } from "./free-windows";
import type { Role, ShareTier } from "./types";

/*
 * Onboarding is a small state machine per room, held in the browser only. The step and the judge's first name live in
 * sessionStorage under the room's id: they never reach the server, the hub or the logs, a reload resumes the same
 * step, and a new room starts over.
 *
 *   name   the greeting and the Friends card (screen 1)
 *   who    who can the Muse talk to: the choice, the synced list, or the pick list (screen 2a, 2b, 2c)
 *   share  what to share with one friend (screen 3)
 *   free   when the person is free this week, and what they feel like doing (side a after share; side b right after the name)
 *   done   onboarding is over, with Friends on, or off after an opt-out
 */

export type OnboardingStep = "name" | "who" | "share" | "free" | "done";

/** What the free step has collected: the chips tapped, a typed line of times, and one line of what they feel like doing. */
export type FreeAnswers = { chips: FreeChipId[]; text: string; feels: string };

/** Which list the who step shows: the sync-or-pick choice, the synced Close Friends list, or the pick list. */
export type OnboardingSource = "none" | "sync" | "pick";

export type OnboardingState = {
  step: OnboardingStep;
  name: string;
  friendsOn: boolean;
  /** One tier per seeded friend id. Everyone starts at off: nothing is pre-selected by us. */
  tiers: Record<string, ShareTier>;
  source: OnboardingSource;
  free: FreeAnswers;
};

export type OnboardingAction =
  | { type: "name"; name: string }
  | { type: "friendsOn" }
  | { type: "notNow" }
  | { type: "sync" }
  | { type: "pick" }
  | { type: "tier"; friendId: string; tier: ShareTier }
  | { type: "continue" }
  | { type: "back" }
  /** Side a: share to the free step. Side b: the name to the free step. */
  | { type: "free" }
  | { type: "chip"; id: FreeChipId }
  | { type: "freeText"; text: string }
  | { type: "feels"; text: string }
  | { type: "done" };

const NAME_LIMIT = 24;
const FREE_TEXT_LIMIT = 160;
const noFreeAnswers = (): FreeAnswers => ({ chips: [], text: "", feels: "" });

function tiersAt(tier: ShareTier): Record<string, ShareTier> {
  return Object.fromEntries(SEEDED_FRIEND_IDS.map((id) => [id, tier]));
}

export function initialOnboarding(): OnboardingState {
  return { step: "name", name: "", friendsOn: false, tiers: tiersAt("off"), source: "none", free: noFreeAnswers() };
}

const optedOut = (state: OnboardingState): OnboardingState => ({ ...state, step: "done", friendsOn: false, tiers: tiersAt("off"), source: "none" });

/**
 * Only a friend whose Muse can take part can start a plan, so Continue means something when one of them is above Off.
 * Someone else above Off with the room's friend at Off is the opt-out: no run starts.
 */
const anyoneAboveOff = (state: OnboardingState) => SEEDED_FRIENDS.some((friend) => friend.museModel !== null && state.tiers[friend.id] !== "off");

/** Every action is a no-op outside the step it belongs to, so a stray tap cannot jump the flow. */
export function reduceOnboarding(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case "name":
      return state.step === "name" ? { ...state, name: action.name.slice(0, NAME_LIMIT) } : state;
    case "friendsOn":
      // Also the "Turn on Friends" pill after an opt-out: it opens screen 2 again, from a clean choice.
      return state.step === "name" || state.step === "done" ? { ...state, step: "who", friendsOn: true, tiers: tiersAt("off"), source: "none" } : state;
    case "notNow":
      return state.step === "name" || state.step === "who" ? optedOut(state) : state;
    case "sync":
      // The judge tapped Sync themselves, so their own Close Friends list is at Close friend.
      return state.step === "who" && state.source === "none" ? { ...state, tiers: tiersAt("close"), source: "sync" } : state;
    case "pick":
      return state.step === "who" && state.source === "none" ? { ...state, tiers: tiersAt("off"), source: "pick" } : state;
    case "tier":
      if (state.step !== "who" || state.source === "none" || !(action.friendId in state.tiers)) return state;
      return { ...state, tiers: { ...state.tiers, [action.friendId]: action.tier } };
    case "continue":
      if (state.step !== "who" || state.source === "none") return state;
      // Nobody who can take part above Off is the opt-out: no run starts.
      return anyoneAboveOff(state) ? { ...state, step: "share" } : optedOut(state);
    case "free":
      // From the share step on side a, from the name step on side b; the screen never sends it anywhere else.
      return state.step === "share" || state.step === "name" ? { ...state, step: "free" } : state;
    case "chip":
      if (state.step !== "free") return state;
      return { ...state, free: { ...state.free, chips: state.free.chips.includes(action.id) ? state.free.chips.filter((id) => id !== action.id) : [...state.free.chips, action.id] } };
    case "freeText":
      return state.step === "free" ? { ...state, free: { ...state.free, text: action.text.slice(0, FREE_TEXT_LIMIT) } } : state;
    case "feels":
      return state.step === "free" ? { ...state, free: { ...state.free, feels: action.text.slice(0, FEELS_MAX) } } : state;
    case "back":
      if (state.step === "free") return { ...state, step: state.friendsOn ? "share" : "name" };
      if (state.step === "share") return { ...state, step: "who" };
      if (state.step === "who" && state.source !== "none") return { ...state, tiers: tiersAt("off"), source: "none" };
      return state;
    case "done":
      return state.step === "share" || state.step === "free" ? { ...state, step: "done" } : state;
  }
}

/** What Sprout calls the judge: the trimmed first name, or "you" when they gave none. */
export function displayName(state: OnboardingState): string {
  return state.name.trim() || "you";
}

const stored = z.object({
  step: z.enum(["name", "who", "share", "free", "done"]),
  name: z.string().max(NAME_LIMIT),
  friendsOn: z.boolean(),
  tiers: z.record(z.string(), z.enum(["close", "friend", "off"])),
  source: z.enum(["none", "sync", "pick"]),
  // Saved before the free step existed: no answers yet.
  free: z
    .object({ chips: z.array(z.enum(["tonight", "tomorrow_evening", "saturday_afternoon", "sunday"])), text: z.string().max(FREE_TEXT_LIMIT), feels: z.string().max(FEELS_MAX) })
    .default(noFreeAnswers()),
});

/** Side a's key is the room's own, as it always was; side b's carries its side, so two tabs on one room never share a step. */
const keyFor = (room: string, role: Role) => (role === "a" ? `muse-friends:onboarding:${room}` : `muse-friends:onboarding:${room}:${role}`);

export function loadOnboarding(room: string, role: Role = "a"): OnboardingState {
  try {
    const raw = sessionStorage.getItem(keyFor(room, role));
    if (raw === null) return initialOnboarding();
    const parsed = stored.safeParse(JSON.parse(raw));
    if (!parsed.success) return initialOnboarding();
    // A friend added since this was saved starts at off; one removed since is dropped.
    return { ...parsed.data, tiers: { ...tiersAt("off"), ...Object.fromEntries(Object.entries(parsed.data.tiers).filter(([id]) => SEEDED_FRIEND_IDS.includes(id))) } };
  } catch {
    return initialOnboarding();
  }
}

export function saveOnboarding(room: string, state: OnboardingState, role: Role = "a"): void {
  try {
    sessionStorage.setItem(keyFor(room, role), JSON.stringify({ ...state, name: state.name.trim() }));
  } catch {
    // Storage can be blocked (a private window): the flow still works, it just does not resume after a reload.
  }
}
