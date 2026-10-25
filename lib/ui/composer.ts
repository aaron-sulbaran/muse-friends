/*
 * What the composer at the bottom of Sprout's phone shows and allows. Pure, so the rules are tested without rendering.
 * It has two modes: a message to the friend, and a private question to your own Muse (D31). The scripted demo never
 * needs either, so nothing here may block the cards above it.
 */

export type ComposerMode = "friend" | "muse";

export type ComposerRules = {
  /** The name on the friend's side of the thread: "Michelle" or "the group". */
  friendLabel: string;
  /** The Muse the person can ask: "Sprout". */
  museName: string;
  /** Whether the chat turn behind Ask is available (it is not until Lane A's turn is on main). */
  askEnabled: boolean;
  /** Whether a typed message to the friend goes anywhere. The simulated friend's lines are scripted, so it does not. */
  friendEnabled: boolean;
};

export type AskPill = "off" | "on" | "unavailable";

export type ComposerView = {
  placeholder: string;
  inputEnabled: boolean;
  askPill: AskPill;
};

/** Tapping the Ask pill switches to a private question and back; while Ask is unavailable it stays on the friend. */
export function toggleMode(mode: ComposerMode, askEnabled: boolean): ComposerMode {
  if (!askEnabled) return "friend";
  return mode === "friend" ? "muse" : "friend";
}

export function composerView(mode: ComposerMode, rules: ComposerRules, copyFor: { message: (friend: string) => string; placeholder: (muse: string) => string }): ComposerView {
  const effective = rules.askEnabled ? mode : "friend";
  return {
    placeholder: effective === "muse" ? copyFor.placeholder(rules.museName) : copyFor.message(rules.friendLabel),
    inputEnabled: effective === "muse" ? true : rules.friendEnabled,
    askPill: !rules.askEnabled ? "unavailable" : effective === "muse" ? "on" : "off",
  };
}

/** A message can be sent when it has words, nothing is already on its way, and the input is open. */
export function canSend(text: string, view: ComposerView, pending: boolean): boolean {
  return view.inputEnabled && !pending && text.trim().length > 0;
}
