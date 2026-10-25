import type { UiMessage, UiNote, UiSnapshot } from "./types";

export type TimelineEntry = { kind: "message"; message: UiMessage } | { kind: "note"; note: UiNote };

/** Messages and notes in the order they happened. Ties keep messages after the note that led to them. */
export function timelineOf(snapshot: Pick<UiSnapshot, "messages" | "notes">): TimelineEntry[] {
  const entries: Array<TimelineEntry & { ms: number; order: number }> = [
    ...snapshot.notes.map((note, index) => ({ kind: "note" as const, note, ms: Date.parse(note.at), order: index })),
    ...snapshot.messages.map((message, index) => ({ kind: "message" as const, message, ms: Date.parse(message.at), order: 1000 + index })),
  ];
  return entries.sort((a, b) => a.ms - b.ms || a.order - b.order).map((entry) => (entry.kind === "note" ? { kind: "note", note: entry.note } : { kind: "message", message: entry.message }));
}
