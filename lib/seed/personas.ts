import type { AgentId, CalendarEvent, Persona, Role, Window } from "@/lib/protocol";

// Everything here is fictional demo data. The calendars are the only source of availability:
// agents see them through get_my_calendar and nothing else.

// Demo "now": Sunday afternoon before the week the plan lands in (US Central, UTC-05:00).
export const DEMO_START = "2026-10-25T14:00:00-05:00";

// Calendar horizon: Sunday Oct 25 through Saturday Oct 31.
export const CALENDAR_RANGE: Window = {
  start: "2026-10-25T00:00:00-05:00",
  end: "2026-11-01T00:00:00-05:00",
};

function event(id: string, title: string, day: string, from: string, to: string, isPrivate = false): CalendarEvent {
  return {
    id,
    title,
    start: `2026-10-${day}T${from}:00-05:00`,
    end: `2026-10-${day}T${to}:00-05:00`,
    private: isPrivate,
  };
}

const aaronCalendar: CalendarEvent[] = [
  event("aaron-01", "Sunday reset: laundry and groceries", "25", "13:00", "22:00"),
  event("aaron-02", "Operating Systems lecture", "26", "10:00", "12:00"),
  event("aaron-03", "Interview, Northwind Labs", "26", "16:00", "17:30", true),
  event("aaron-04", "Study group", "26", "17:30", "21:00"),
  event("aaron-05", "Signals lecture", "27", "09:30", "11:00"),
  event("aaron-06", "Embedded systems lab", "27", "14:00", "18:00"),
  event("aaron-07", "Operating Systems lecture", "28", "10:00", "12:00"),
  event("aaron-08", "Library shift", "28", "12:30", "17:00"),
  event("aaron-09", "Intramural volleyball", "28", "17:00", "21:00"),
  event("aaron-10", "Signals lecture", "29", "11:00", "12:30"),
  event("aaron-11", "Library closing shift", "29", "15:00", "22:00"),
  event("aaron-12", "Operating Systems lecture", "30", "10:00", "12:00"),
  event("aaron-13", "Family dinner", "30", "18:00", "21:30", true),
  event("aaron-14", "Climbing gym", "31", "14:00", "18:00"),
];

const lisaCalendar: CalendarEvent[] = [
  event("lisa-01", "Family dinner", "25", "13:00", "22:00", true),
  event("lisa-02", "Classes", "26", "09:00", "15:00"),
  event("lisa-03", "Dance rehearsal", "26", "18:00", "20:00"),
  event("lisa-04", "Classes and studio", "27", "09:00", "17:00"),
  event("lisa-05", "Physical therapy", "27", "20:00", "21:30", true),
  event("lisa-06", "Classes and TA hours", "28", "09:00", "18:00"),
  event("lisa-07", "Book club", "28", "19:30", "21:30"),
  event("lisa-08", "Classes and lab", "29", "09:00", "18:30"),
  event("lisa-09", "Classes", "30", "10:00", "16:00"),
  event("lisa-10", "Friend's birthday", "30", "19:00", "23:00", true),
  event("lisa-11", "Farmers market shift", "31", "12:00", "18:00"),
];

export const PERSONAS: Record<AgentId, Persona> = {
  aaron: {
    id: "aaron",
    role: "a",
    displayName: "Sprout",
    calendar: aaronCalendar,
    interests: {
      food: ["shawarma", "ramen", "breakfast tacos"],
      events: ["live music", "hackathons"],
      interests: ["embedded systems", "pickup soccer", "film photography"],
      location: ["East Austin", "campus"],
    },
    provenance: {
      source: "seeded",
      fictional: true,
      note: "Fictional demo persona; details are invented.",
    },
  },
  lisa: {
    id: "lisa",
    role: "b",
    displayName: "Mochi",
    calendar: lisaCalendar,
    interests: {
      food: ["shawarma", "dumplings", "matcha"],
      events: ["live music", "pop-up markets"],
      interests: ["ceramics", "film photography", "trail running"],
      location: ["East Austin", "Hyde Park"],
    },
    provenance: {
      source: "seeded",
      fictional: true,
      note: "Fictional demo persona; details are invented.",
    },
  },
};

export function getPersona(id: AgentId): Persona {
  return PERSONAS[id];
}

// What people see: the Muse characters Sprout and Mochi, not the internal ids.
export function displayName(id: AgentId): string {
  return PERSONAS[id].displayName;
}

export const ROLE_TO_AGENT: Record<Role, AgentId> = { a: "aaron", b: "lisa" };
export const AGENT_TO_ROLE: Record<AgentId, Role> = { aaron: "a", lisa: "b" };

// Strings that must never appear in any delivered message. Used by the leak tests (smoke test 5).
export const PRIVATE_STRINGS: Record<AgentId, string[]> = {
  aaron: ["Northwind", "Interview", "Family dinner"],
  lisa: ["Physical therapy", "Friend's birthday", "Family dinner"],
};
