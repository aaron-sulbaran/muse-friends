import { copy } from "./copy";
import type { UiSnapshot } from "./types";

/*
 * The three moments the stage header lights up, in the order they happen. They replace the Follow-through counter:
 * each says what it means and when it happened, from the plan's own history, so nothing here is a new count.
 */

export type MomentKey = "said-yes" | "message-sent" | "they-went";

export type Moment = {
  key: MomentKey;
  label: string;
  /** One line on what the moment means; the card shows it under the name. */
  line: string;
  /** When it happened, ISO, or null while it has not. */
  reachedAt: string | null;
};

/** Plan states a plan only reaches after the draft was taken away (the handoff moves a confirmed plan on to scheduled). */
const AFTER_HANDOFF = ["scheduled", "reminded", "happened", "followed_up"] as const;

export function momentsOf(snapshot: Pick<UiSnapshot, "plan" | "followThrough"> | null): Moment[] {
  const plan = snapshot?.plan ?? null;
  const live = plan !== null && plan.state !== "dropped";
  const bothSaidYes = live && plan.decisions.a === "accepted" && plan.decisions.b === "accepted";
  const confirmedAt = plan?.history.find((entry) => entry.state === "confirmed")?.at ?? null;
  const handoffAt = plan?.history.find((entry) => (AFTER_HANDOFF as readonly string[]).includes(entry.state))?.at ?? null;
  const wentAt = snapshot?.followThrough.events[0]?.at ?? null;
  return [
    { key: "said-yes", label: copy.momentSaidYes, line: copy.momentSaidYesLine, reachedAt: bothSaidYes ? (confirmedAt ?? snapshotNow(plan)) : null },
    { key: "message-sent", label: copy.momentMessageSent, line: copy.momentMessageSentLine, reachedAt: live ? handoffAt : null },
    { key: "they-went", label: copy.momentTheyWent, line: copy.momentTheyWentLine, reachedAt: wentAt },
  ];
}

/** A plan both people accepted whose history has no confirmed entry (a recording trimmed it): its latest state change stands in. */
function snapshotNow(plan: NonNullable<UiSnapshot["plan"]>): string {
  return plan.history.at(-1)?.at ?? "";
}
