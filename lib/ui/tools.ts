/*
 * The tools a model call used, for the JSON drawer: each as a name, a one-line summary of what it was called
 * with, and a one-line summary of what it returned. The store's proof may carry them as `toolCalls`; when it
 * does not, the drawer shows nothing about tools rather than an empty list.
 */

export type UiToolCall = { name: string; args: string; result: string };

const MAX_LINE = 140;

/** Anything as one readable line: whitespace collapsed, objects as JSON, long text cut with an ellipsis of dots. */
export function oneLine(value: unknown): string {
  const text = typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);
  const line = (text ?? "").replace(/\s+/g, " ").trim();
  return line.length > MAX_LINE ? `${line.slice(0, MAX_LINE - 3).trimEnd()}...` : line;
}

/** The tool calls on a message's proof, tolerant of the shape still settling; undefined when there are none to show. */
export function toolCallsOf(proof: unknown): UiToolCall[] | undefined {
  const raw = (proof as { toolCalls?: unknown } | null | undefined)?.toolCalls;
  if (!Array.isArray(raw)) return undefined;
  const calls = raw.flatMap((entry): UiToolCall[] => {
    const call = entry as { name?: unknown; args?: unknown; result?: unknown } | null;
    if (typeof call?.name !== "string" || call.name.trim() === "") return [];
    return [{ name: call.name.trim(), args: oneLine(call.args), result: oneLine(call.result) }];
  });
  return calls.length > 0 ? calls : undefined;
}
