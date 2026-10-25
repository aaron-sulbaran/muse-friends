import { describe, expect, it } from "vitest";
import { enforceSharePolicy, projectShared } from "@/lib/policy";
import { AgentMessage, SharePolicy, type AgentMessage as Message } from "@/lib/protocol";
import { PERSONAS, PRIVATE_STRINGS } from "@/lib/seed/fixtures";

const tuesday = { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" };
const lisa = PERSONAS.lisa;

const policy = (overrides: Partial<SharePolicy["categories"]> = {}, tier: SharePolicy["tier"] = "close"): SharePolicy =>
  SharePolicy.parse({ owner: "lisa", friend: "aaron", tier, categories: overrides });

function message(overrides: Partial<Message> = {}): Message {
  return AgentMessage.parse({
    id: "msg_1",
    contextId: "ctx_1",
    seq: 2,
    from: "lisa",
    to: "aaron",
    type: "propose",
    state: "working",
    activity: { kind: "food", title: "Shawarma Point", place: "E 6th St" },
    windows: [tuesday],
    reason: "interest_match",
    note: "Tuesday 6 to 8 is open on my side.",
    shared: { food: ["shawarma", "dumplings"], location: ["East Austin"] },
    at: "2026-10-25T14:00:14-05:00",
    ...overrides,
  });
}

describe("projectShared", () => {
  it("builds shared from the sender's own data for allowed categories only", () => {
    const shared = projectShared(lisa, ["food", "location", "interests"], policy({ location: false }));
    expect(shared).toEqual({ food: lisa.interests.food, interests: lisa.interests.interests });
  });

  it("shares nothing at tier off or with no policy", () => {
    expect(projectShared(lisa, ["food"], policy({}, "off"))).toBeUndefined();
    expect(projectShared(lisa, ["food"], null)).toBeUndefined();
  });

  it("ignores categories the persona has no data for and nothing requested", () => {
    expect(projectShared(lisa, undefined, policy())).toBeUndefined();
    expect(projectShared({ ...lisa, interests: {} }, ["food"], policy())).toBeUndefined();
  });
});

describe("enforceSharePolicy", () => {
  it("leaves a clean message alone and logs nothing", () => {
    const outcome = enforceSharePolicy({ message: message(), policy: policy(), sender: lisa });
    expect(outcome.message).toEqual(message());
    expect(outcome.redaction).toBeNull();
    expect(outcome.stamp).toEqual({ passed: ["food", "availability", "location"], removed: [], windowsDropped: 0 });
  });

  it("blanks the place and the location list when location is off, and logs a redaction without the value", () => {
    const outcome = enforceSharePolicy({ message: message(), policy: policy({ location: false }), sender: lisa });
    expect(outcome.message.activity).toEqual({ kind: "food", title: "Shawarma Point" });
    expect(outcome.message.shared).toEqual({ food: ["shawarma", "dumplings"] });
    expect(outcome.stamp).toMatchObject({ passed: ["food", "availability"], removed: ["location"] });
    expect(outcome.redaction).toMatchObject({ id: "red_msg_1", messageId: "msg_1", removed: ["location"], from: "lisa", to: "aaron" });
    expect(JSON.stringify(outcome.redaction)).not.toContain("E 6th St");
    expect(JSON.stringify(outcome.redaction)).not.toContain("East Austin");
  });

  it("removes windows when availability is off", () => {
    const outcome = enforceSharePolicy({ message: message({ type: "intent" }), policy: policy({ availability: false }), sender: lisa });
    expect(outcome.message.windows).toBeUndefined();
    expect(outcome.removed).toEqual(["availability"]);
  });

  it("strips every category at tier off but keeps the message deliverable as shape", () => {
    const outcome = enforceSharePolicy({ message: message({ type: "intent" }), policy: policy({}, "off"), sender: lisa });
    expect(outcome.message.shared).toBeUndefined();
    expect(outcome.message.windows).toBeUndefined();
    expect(outcome.message.activity?.place).toBeUndefined();
    expect(outcome.removed).toEqual(["food", "availability", "location"]);
  });

  it("drops a shared key that a bug let through for an off category", () => {
    const outcome = enforceSharePolicy({ message: message({ shared: { interests: ["ceramics"] } }), policy: policy({ interests: false }), sender: lisa });
    expect(outcome.message.shared).toBeUndefined();
    expect(outcome.removed).toEqual(["interests"]);
  });

  describe("scanning the note", () => {
    const leaks = [
      "Can't do Tuesday, I have physical therapy.",
      "I'm free after the friend's birthday party",
      "Let me check, my therapy runs late",
      "PHYSICAL THERAPY ends at 9",
    ];
    for (const note of leaks) {
      it(`removes a note naming a private event: ${note}`, () => {
        const outcome = enforceSharePolicy({ message: message({ note }), policy: policy(), sender: lisa });
        expect(outcome.message.note).toBeUndefined();
        expect(outcome.removed).toContain("events");
        expect(JSON.stringify(outcome.redaction)).not.toMatch(/therapy|birthday/i);
      });
    }

    it("catches the private strings seeded for both personas", () => {
      for (const [id, strings] of Object.entries(PRIVATE_STRINGS)) {
        const persona = PERSONAS[id as "aaron" | "lisa"];
        for (const secret of strings.filter((entry) => persona.calendar.some((event) => event.private && event.title.includes(entry)))) {
          const outcome = enforceSharePolicy({ message: message({ note: `Sorry, ${secret} that day` }), policy: policy(), sender: persona });
          expect(outcome.message.note, secret).toBeUndefined();
        }
      }
    });

    it("lets ordinary notes through", () => {
      for (const note of ["Tuesday works. I'll aim for 6:30 so I can get there after class.", "Yes to shawarma. These are my open evenings.", "6:30 is good. See you there."]) {
        const outcome = enforceSharePolicy({ message: message({ note }), policy: policy(), sender: lisa });
        expect(outcome.message.note).toBe(note);
        expect(outcome.removed).toEqual([]);
      }
    });

    it("removes a note carrying location values when location is off", () => {
      for (const note of ["I'm around East Austin anyway", "Near Hyde Park works", "Meet at E 6th St"]) {
        const outcome = enforceSharePolicy({ message: message({ note }), policy: policy({ location: false }), sender: lisa });
        expect(outcome.message.note, note).toBeUndefined();
        expect(outcome.removed).toContain("location");
      }
    });

    it("removes a note carrying an off-category interest", () => {
      const outcome = enforceSharePolicy({ message: message({ note: "Also into ceramics lately" }), policy: policy({ interests: false }), sender: lisa });
      expect(outcome.message.note).toBeUndefined();
      expect(outcome.removed).toContain("interests");
    });

    it("hides non-private event titles only when events is off", () => {
      const note = "I have classes and studio until 5";
      expect(enforceSharePolicy({ message: message({ note }), policy: policy(), sender: lisa }).message.note).toBe(note);
      expect(enforceSharePolicy({ message: message({ note }), policy: policy({ events: false }), sender: lisa }).message.note).toBeUndefined();
    });
  });

  it("lets a note name the activity the friend already knows about, even when food is off", () => {
    const note = "Shawarma Point looks great";
    const outcome = enforceSharePolicy({ message: message({ note, shared: undefined }), policy: policy({ food: false }), sender: lisa });
    expect(outcome.message.note).toBe(note);
    expect(outcome.message.activity?.title).toBe("Shawarma Point");
    // ...but still hides other food interests.
    const leaky = enforceSharePolicy({ message: message({ note: "I also love dumplings", shared: undefined }), policy: policy({ food: false }), sender: lisa });
    expect(leaky.message.note).toBeUndefined();
  });

  it("neutralizes a leaking activity title", () => {
    const outcome = enforceSharePolicy({ message: message({ activity: { kind: "food", title: "Dinner before physical therapy" } }), policy: policy(), sender: lisa });
    expect(outcome.message.activity?.title).toBe("A plan");
    expect(outcome.removed).toContain("events");
  });

  it("carries the dropped-window count into the stamp", () => {
    const outcome = enforceSharePolicy({ message: message(), policy: policy(), sender: lisa, windowsDropped: 2 });
    expect(outcome.stamp.windowsDropped).toBe(2);
  });

  it("does not mutate its input", () => {
    const input = message();
    enforceSharePolicy({ message: input, policy: policy({ location: false }), sender: lisa });
    expect(input).toEqual(message());
  });
});
