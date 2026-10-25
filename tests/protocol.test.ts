import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AgentMessage,
  MessageDraft,
  SendToFriendArgs,
  SharePolicy,
  categoriesInMessage,
  isCategoryAllowed,
  type AgentMessage as AgentMessageType,
} from "@/lib/protocol";

const tuesday = { start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" };

const propose: AgentMessageType = {
  id: "msg_1",
  contextId: "ctx_1",
  seq: 1,
  from: "aaron",
  to: "lisa",
  type: "propose",
  state: "working",
  activity: { kind: "food", title: "Shawarma Point", place: "E 6th St" },
  windows: [tuesday],
  reason: "both_free",
  note: "Tuesday works on my side.",
  shared: { food: ["shawarma"] },
  at: "2026-10-25T14:00:08-05:00",
};

function parse(overrides: Record<string, unknown>) {
  return AgentMessage.safeParse({ ...propose, ...overrides });
}

describe("AgentMessage", () => {
  it("accepts a well formed propose", () => {
    expect(AgentMessage.safeParse(propose).success).toBe(true);
  });

  it("is strict about unknown keys, including rationale", () => {
    expect(parse({ rationale: "she is free after her physical therapy" }).success).toBe(false);
  });

  it("has no availability key in shared", () => {
    expect(parse({ shared: { availability: ["Tuesday"] } }).success).toBe(false);
    expect(parse({ shared: { food: ["shawarma"], extra: ["x"] } }).success).toBe(false);
  });

  it("caps the note at 140 characters", () => {
    expect(parse({ note: "x".repeat(140) }).success).toBe(true);
    expect(parse({ note: "x".repeat(141) }).success).toBe(false);
  });

  it("caps the activity title at 60 characters", () => {
    expect(parse({ activity: { kind: "food", title: "x".repeat(61) } }).success).toBe(false);
  });

  it("allows at most 3 windows", () => {
    expect(parse({ windows: [tuesday, tuesday, tuesday, tuesday] }).success).toBe(false);
  });

  it("rejects a window that ends before it starts", () => {
    expect(parse({ windows: [{ start: tuesday.end, end: tuesday.start }] }).success).toBe(false);
  });

  it("rejects windows without an offset", () => {
    expect(parse({ windows: [{ start: "2026-10-27T18:00:00", end: "2026-10-27T20:00:00" }] }).success).toBe(false);
  });

  it("caps seq at the 6 message thread cap", () => {
    expect(parse({ seq: 6 }).success).toBe(true);
    expect(parse({ seq: 7 }).success).toBe(false);
    expect(parse({ seq: 0 }).success).toBe(false);
  });

  it("rejects a message to oneself", () => {
    expect(parse({ to: "aaron" }).success).toBe(false);
  });

  it("rejects an unknown reason, type, or state", () => {
    expect(parse({ reason: "because" }).success).toBe(false);
    expect(parse({ type: "ping" }).success).toBe(false);
    expect(parse({ state: "done" }).success).toBe(false);
  });

  describe("window rules by type", () => {
    it("propose needs windows", () => {
      expect(parse({ windows: undefined }).success).toBe(false);
    });

    it("accept needs exactly one window", () => {
      expect(parse({ type: "accept", windows: [tuesday] }).success).toBe(true);
      expect(parse({ type: "accept", windows: undefined }).success).toBe(false);
      expect(parse({ type: "accept", windows: [tuesday, tuesday] }).success).toBe(false);
    });

    it("counter without windows is only valid as no_overlap or cap_reached", () => {
      expect(parse({ type: "counter", windows: undefined, reason: "both_free" }).success).toBe(false);
      expect(parse({ type: "counter", windows: undefined, reason: "no_overlap" }).success).toBe(true);
    });

    it("decline carries no windows", () => {
      expect(parse({ type: "decline", windows: undefined, reason: "no_overlap" }).success).toBe(true);
      expect(parse({ type: "decline", windows: [tuesday] }).success).toBe(false);
    });

    it("intent may go out with or without windows", () => {
      expect(parse({ type: "intent", windows: undefined }).success).toBe(true);
      expect(parse({ type: "intent", windows: [tuesday] }).success).toBe(true);
    });
  });
});

describe("MessageDraft and SendToFriendArgs", () => {
  const draft = { type: "propose", reason: "both_free", windows: [tuesday], share: ["food"] };

  it("accepts what the model is allowed to author", () => {
    expect(MessageDraft.safeParse(draft).success).toBe(true);
    expect(SendToFriendArgs.safeParse({ ...draft, friend: "lisa" }).success).toBe(true);
  });

  it("rejects fields only the runtime may set", () => {
    for (const forged of [{ from: "lisa" }, { seq: 1 }, { state: "completed" }, { contextId: "ctx_x" }, { shared: {} }]) {
      expect(MessageDraft.safeParse({ ...draft, ...forged }).success).toBe(false);
    }
  });

  it("cannot request availability through share", () => {
    expect(MessageDraft.safeParse({ ...draft, share: ["availability"] }).success).toBe(false);
  });

  it("needs a friend", () => {
    expect(SendToFriendArgs.safeParse(draft).success).toBe(false);
  });

  it("converts to a JSON schema closed to extra properties, for use as tool parameters", () => {
    const schema = z.toJSONSchema(SendToFriendArgs, { target: "draft-07" }) as {
      type: string;
      additionalProperties?: boolean;
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining(["friend", "type", "reason"]));
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["activity", "friend", "note", "reason", "share", "type", "windows"].sort(),
    );
  });
});

describe("SharePolicy", () => {
  const close = SharePolicy.parse({ owner: "lisa", friend: "aaron", tier: "close", categories: {} });
  const friend = SharePolicy.parse({ owner: "lisa", friend: "aaron", tier: "friend", categories: {} });
  const off = SharePolicy.parse({ owner: "lisa", friend: "aaron", tier: "off", categories: { food: true } });

  it("rejects a policy about oneself", () => {
    expect(SharePolicy.safeParse({ owner: "lisa", friend: "lisa", tier: "close", categories: {} }).success).toBe(false);
  });

  it("applies tier defaults", () => {
    expect(isCategoryAllowed(close, "location")).toBe(true);
    expect(isCategoryAllowed(friend, "location")).toBe(false);
    expect(isCategoryAllowed(friend, "food")).toBe(true);
  });

  it("lets explicit categories override the tier", () => {
    const toggled = { ...close, categories: { location: false } };
    expect(isCategoryAllowed(toggled, "location")).toBe(false);
    expect(isCategoryAllowed({ ...friend, categories: { location: true } }, "location")).toBe(true);
  });

  it("shares nothing at tier off or with no policy", () => {
    expect(isCategoryAllowed(off, "food")).toBe(false);
    expect(isCategoryAllowed(null, "food")).toBe(false);
    expect(isCategoryAllowed(undefined, "availability")).toBe(false);
  });
});

describe("categoriesInMessage", () => {
  it("maps windows to availability and place to location", () => {
    expect(categoriesInMessage(propose)).toEqual(["food", "availability", "location"]);
  });

  it("is empty for a bare decline", () => {
    expect(categoriesInMessage({})).toEqual([]);
  });
});
