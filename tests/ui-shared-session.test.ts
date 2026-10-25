import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FreeTimeCard } from "@/components/FreeTimeCard";
import { FriendNameCard } from "@/components/FriendNameCard";
import { MuseScreen } from "@/components/MuseScreen";
import { snapshotAtPlanState } from "@/lib/seed/states";
import { postAvailability } from "@/lib/ui/actions";
import { onboardingItems, viewForRole, type ChatItem } from "@/lib/ui/chat";
import { copy } from "@/lib/ui/copy";
import { freeChips } from "@/lib/ui/free-windows";
import { initialOnboarding, reduceOnboarding, type OnboardingAction } from "@/lib/ui/onboarding";
import { toUiSnapshot } from "@/lib/ui/snapshot";
import { threadLines } from "@/lib/ui/thread";
import type { UiSnapshot } from "@/lib/ui/types";

const live = { mode: "live" } as const;
const NOW = "2026-10-25T14:00:00-05:00";
const noop = () => undefined;
const run = (actions: OnboardingAction[]) => actions.reduce(reduceOnboarding, initialOnboarding());
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
const kinds = (items: ChatItem[]) => items.map((item) => item.kind);

describe("what the invited phone's onboarding shows", () => {
  it("opens with its own Muse's greeting and just a name, with no Friends choice", () => {
    const items = onboardingItems(initialOnboarding(), "Michelle", "b", "Mochi");
    expect(items).toEqual([{ kind: "bubble", id: "onboarding-greeting", from: "muse", text: "Hi, I'm Mochi, your Muse." }, { kind: "onboarding-name", id: "onboarding-name" }]);
  });

  it("then asks when the person is free, and is the greeting alone once done", () => {
    const free = onboardingItems(run([{ type: "name", name: "Jordan" }, { type: "free" }]), "Michelle", "b", "Mochi");
    expect(kinds(free)).toEqual(["bubble", "onboarding-free"]);
    expect(kinds(onboardingItems(run([{ type: "name", name: "Jordan" }, { type: "free" }, { type: "done" }]), "Michelle", "b", "Mochi"))).toEqual(["bubble"]);
  });

  it("adds the same card to the judge's phone after the share step, and nothing changes before it", () => {
    const atShare = run([{ type: "friendsOn" }, { type: "sync" }, { type: "continue" }]);
    expect(kinds(onboardingItems(atShare, "Michelle"))).toEqual(["bubble", "bubble"]);
    expect(kinds(onboardingItems(reduceOnboarding(atShare, { type: "free" }), "Michelle"))).toEqual(["bubble", "bubble", "onboarding-free"]);
    expect(kinds(onboardingItems(initialOnboarding(), "Michelle"))).toEqual(["bubble", "onboarding-friends"]);
  });
});

describe("the free-time card", () => {
  const card = (props: Partial<Parameters<typeof FreeTimeCard>[0]> = {}) =>
    renderToStaticMarkup(createElement(FreeTimeCard, { state: run([{ type: "name", name: "Jordan" }, { type: "free" }]), nowIso: NOW, dispatch: noop, onDone: noop, saving: false, error: null, ...props }));

  it("shows the times still ahead as chips, a place to type one, the feeling line and the sandbox line", () => {
    const html = text(card());
    for (const chip of freeChips(NOW)) expect(html).toContain(chip.label);
    expect(html).not.toContain("Sunday");
    expect(card()).toContain('placeholder="Tue 6 to 8 PM"');
    expect(html).toContain("What do you feel like doing? Optional");
    expect(html).toContain("In this sandbox your Muse only knows what you tell it here. In Muse it would know you, and it would suggest plans instead of asking.");
  });

  it("marks the chosen chips as pressed", () => {
    const state = run([{ type: "name", name: "J" }, { type: "free" }, { type: "chip", id: "tonight" }]);
    const html = card({ state });
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(freeChips(NOW).length - 1);
  });

  it("offers Skip to the judge's phone only: the invited phone has to give a time", () => {
    expect(text(card({ onSkip: noop }))).toContain("Skip");
    expect(text(card())).not.toContain("Skip");
  });

  it("says what went wrong in a line, and shows saving while it posts", () => {
    expect(card({ error: "Pick at least one time you are free." })).toContain('role="alert"');
    expect(text(card({ saving: true }))).toContain("Saving...");
  });

  it("has no emoji and no em dash", () => {
    expect(card()).not.toMatch(/\p{Extended_Pictographic}|\u2014|\u2013/u);
  });
});

describe("the invited phone's name card", () => {
  it("asks for a name and goes on with Next", () => {
    const html = renderToStaticMarkup(createElement(FriendNameCard, { state: initialOnboarding(), dispatch: noop }));
    expect(html).toContain('aria-label="Your first name"');
    expect(text(html)).toContain("Next");
  });
});

describe("the invited phone on screen", () => {
  const snapshot = (over: Partial<UiSnapshot> = {}): UiSnapshot => ({ ...toUiSnapshot(snapshotAtPlanState("detected"), live), plan: null, simulatedFriend: false, ...over });
  const screen = (role: "a" | "b", over: Partial<UiSnapshot> = {}, onboarding = true) =>
    renderToStaticMarkup(createElement(MuseScreen, { snapshot: snapshot(over), role, onChanged: noop, onboarding, standalone: { activity: () => null } } as never));

  it("begins with Mochi's greeting and the name card, and nothing else to tap", () => {
    const html = screen("b");
    expect(text(html)).toContain("Hi, I'm Mochi, your Muse.");
    expect(html).toContain('aria-label="Your first name"');
    expect(html).not.toContain("Open Mochi settings");
  });

  it("does not ask a side b that Michelle is playing, and a phone with onboarding off is as it was", () => {
    expect(text(screen("b", { simulatedFriend: true }))).not.toContain("Hi, I'm Mochi");
    expect(text(screen("b", {}, false))).not.toContain("Hi, I'm Mochi");
  });
});

describe("the notes about what you said", () => {
  const base = (): UiSnapshot => toUiSnapshot(snapshotAtPlanState("awaiting_humans"), live);
  const week = { windows: [{ start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" }, { start: "2026-10-31T13:00:00-05:00", end: "2026-10-31T17:00:00-05:00" }], feels: "ramen" };

  it("puts a private one-line note first on the phone of the person who typed, from their own Muse", () => {
    const lines = threadLines({ ...base(), typedAvailability: { aaron: week } }, "a");
    expect(lines[0]).toMatchObject({ id: "thread-typed-free", onlyYou: true, text: "You said you're free: Tue evening, Sat afternoon", sender: { kind: "your-muse", name: "Sprout" } });
  });

  it("never shows it to the other side, and each side sees its own", () => {
    const snapshot = { ...base(), typedAvailability: { aaron: week } };
    expect(threadLines(snapshot, "b").some((line) => line.id === "thread-typed-free")).toBe(false);
    const both = threadLines({ ...base(), typedAvailability: { aaron: week, lisa: { windows: [week.windows[0]], feels: null } } }, "b");
    expect(both[0]).toMatchObject({ id: "thread-typed-free", text: "You said you're free: Tue evening", sender: { kind: "your-muse", name: "Mochi" } });
  });

  it("says when the two weeks do not meet, and says nothing when they do or it is not known", () => {
    const none = threadLines({ ...base(), typedAvailability: { aaron: week, overlap: false } }, "a").map((line) => line.text);
    expect(none).toContain(copy.threadNoSharedFree);
    expect(copy.threadNoSharedFree).toBe("No shared free time this week; try more windows");
    for (const overlap of [true, null, undefined]) {
      expect(threadLines({ ...base(), typedAvailability: { aaron: week, overlap } }, "a").some((line) => line.text === copy.threadNoSharedFree)).toBe(false);
    }
  });

  it("is nothing at all when nobody typed anything", () => {
    expect(threadLines(base(), "a").some((line) => line.id.startsWith("thread-typed") || line.id === "thread-no-shared-free")).toBe(false);
  });

  it("reaches the chat as a private aside before the exchange", () => {
    const snapshot = { ...base(), typedAvailability: { aaron: week } };
    const items = viewForRole(snapshot, "a").items;
    const note = items.findIndex((item) => item.kind === "thread-line" && item.line.id === "thread-typed-free");
    expect(note).toBeGreaterThan(-1);
    expect(items.findIndex((item) => item.kind === "thread-line" && item.line.phase === "talk" && !item.line.onlyYou)).toBeGreaterThan(note);
  });
});

describe("what is posted", () => {
  afterEach(() => vi.unstubAllGlobals());
  const stub = (status: number, body: unknown) => {
    const mock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", mock);
    return mock;
  };
  const windows = [{ start: "2026-10-27T18:00:00-05:00", end: "2026-10-27T20:00:00-05:00" }];

  it("sends the side, the windows, the feeling and the name to the availability route, and nothing it has not got", async () => {
    const mock = stub(200, { data: {}, error: null });
    expect(await postAvailability({ side: "b", windows, feels: "ramen", name: "Jordan" })).toEqual({ ok: true });
    const [url, init] = mock.mock.calls[0] as unknown as [string, { body: string }];
    expect(url).toContain("/api/availability");
    expect(JSON.parse(init.body)).toEqual({ side: "b", windows, feels: "ramen", name: "Jordan" });
    await postAvailability({ side: "a", windows, feels: null, name: "" });
    expect(JSON.parse((mock.mock.calls[1] as unknown as [string, { body: string }])[1].body)).toEqual({ side: "a", windows });
  });

  it("hands the server's plain message to the screen when a window is refused", async () => {
    stub(400, { data: null, error: { message: "Each window needs to be at least an hour." } });
    expect(await postAvailability({ side: "b", windows, feels: null, name: "" })).toEqual({ ok: false, message: "Each window needs to be at least an hour." });
  });
});
