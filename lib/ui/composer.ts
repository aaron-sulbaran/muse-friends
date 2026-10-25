/*
 * What the "Message" bar at the bottom of Sprout's phone shows and allows. Pure, so the rules are tested without
 * rendering. It has one mode: whatever is typed goes to your own Muse (D31) and is answered by it. The scripted demo
 * never needs it, so nothing here may block the cards above it.
 */
import { copy } from "./copy";

export type ComposerRules = {
  /** The Muse the person is talking to: "Sprout". It names the field for a screen reader; the visible hint stays "Message". */
  museName: string;
};

export type ComposerView = {
  placeholder: string;
  /** The field's accessible name, with the Muse in it: "Message Sprout". */
  label: string;
};

export function composerView(rules: ComposerRules): ComposerView {
  return { placeholder: copy.composerPlaceholder, label: copy.composerLabel(rules.museName) };
}

/** A message can be sent when it has words and nothing is already on its way. The field itself is never closed. */
export function canSend(text: string, pending: boolean): boolean {
  return !pending && text.trim().length > 0;
}
