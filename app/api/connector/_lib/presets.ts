import { describeWindow, toCentralIso, toMs } from "@/lib/agent/windows";
import type { Window } from "@/lib/protocol";

// The only inputs a judge's Muse can pick for start_plan: three fixed, fictional sets of free time that we
// supply. Nothing a person types, no calendar of theirs, and nothing personal goes into a room. Each preset
// gives Sprout (the judge's side) and Mochi (the fictional friend) their free windows for the week of the
// demo calendar, in US Central. Every preset has at least one window both of them share, so a plan always
// has something to agree on (tests/byom.test.ts checks it).

export const SLOT_PRESET_NAMES = ["evenings", "lunches", "weekend"] as const;
export type SlotPreset = (typeof SLOT_PRESET_NAMES)[number];

const central = (day: string, startHour: number, endHour: number): Window => ({
  start: toCentralIso(Date.parse(`${day}T${String(startHour).padStart(2, "0")}:00:00-05:00`)),
  end: toCentralIso(Date.parse(`${day}T${String(endHour).padStart(2, "0")}:00:00-05:00`)),
});

export const SLOT_PRESETS: Record<SlotPreset, { description: string; sprout: Window[]; mochi: Window[] }> = {
  evenings: {
    description: "Weekday evenings",
    sprout: [central("2026-10-27", 18, 21), central("2026-10-28", 18, 20), central("2026-10-29", 19, 22)],
    mochi: [central("2026-10-27", 17, 20), central("2026-10-29", 19, 22)],
  },
  lunches: {
    description: "Weekday lunch breaks",
    sprout: [central("2026-10-26", 12, 14), central("2026-10-27", 12, 14), central("2026-10-30", 12, 14)],
    mochi: [central("2026-10-27", 12, 13), central("2026-10-30", 13, 15)],
  },
  weekend: {
    description: "Saturday",
    sprout: [central("2026-10-31", 10, 14), central("2026-10-31", 18, 22)],
    mochi: [central("2026-10-31", 11, 13), central("2026-10-31", 19, 22)],
  },
};

export function isSlotPreset(value: unknown): value is SlotPreset {
  return typeof value === "string" && (SLOT_PRESET_NAMES as readonly string[]).includes(value);
}

// Windows that have not already ended, so a plan never starts from a calendar that is in the past.
export function presetWindows(preset: SlotPreset, nowMs: number): { sprout: Window[]; mochi: Window[] } {
  const upcoming = (windows: Window[]) => windows.filter((window) => toMs(window.end) > nowMs);
  return { sprout: upcoming(SLOT_PRESETS[preset].sprout), mochi: upcoming(SLOT_PRESETS[preset].mochi) };
}

// For the /connect page: what each preset means, in words a person can read.
export function describePresets(): Array<{ name: SlotPreset; description: string; sprout: string[]; mochi: string[] }> {
  return SLOT_PRESET_NAMES.map((name) => ({
    name,
    description: SLOT_PRESETS[name].description,
    sprout: SLOT_PRESETS[name].sprout.map(describeWindow),
    mochi: SLOT_PRESETS[name].mochi.map(describeWindow),
  }));
}
