import type { TimeWindow } from "./types";

export type HoldEvent = {
  uid: string;
  summary: string;
  window: TimeWindow;
  /** When the hold was created; becomes DTSTAMP. */
  stampedAt: string;
};

/** 20261027T230000Z */
function utcStamp(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** RFC 5545 text escaping for SUMMARY. */
function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Fold lines longer than 75 octets, continuing with a leading space. */
function fold(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const chunks: string[] = [];
  let current = "";
  for (const char of line) {
    const limit = chunks.length === 0 ? 75 : 74;
    if (encoder.encode(current + char).length > limit) {
      chunks.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  chunks.push(current);
  return chunks.join("\r\n ");
}

/** A single-event calendar file with CRLF line endings, UTC times, UID, and DTSTAMP. */
export function buildHoldIcs(event: HoldEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Muse Friends//Hold//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${utcStamp(event.stampedAt)}`,
    `DTSTART:${utcStamp(event.window.start)}`,
    `DTEND:${utcStamp(event.window.end)}`,
    `SUMMARY:${escapeText(event.summary)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}
