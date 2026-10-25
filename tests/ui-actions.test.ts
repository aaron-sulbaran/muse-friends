import { afterEach, describe, expect, it, vi } from "vitest";
import { postChat, postFollowUp, postReplan, postSignal, postSimulatedAnswer } from "@/lib/ui/actions";

function stubFetch(responses: Array<{ status: number; body: unknown }>) {
  const queue = [...responses];
  const fetchMock = vi.fn(async () => {
    const next = queue.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

const paused = { paused: true, reason: "room", text: "Live runs paused, playing a recording", budget: { paused: true } };

describe("a start the caps refuse is a fallback, not an error", () => {
  it("reads the signals route's 429 as paused, with the route's own text", async () => {
    stubFetch([{ status: 429, body: paused }]);
    expect(await postSignal()).toEqual({ ok: false, paused: true, message: "Live runs paused, playing a recording" });
  });

  it("reads the simulated friend's 429 the same way", async () => {
    stubFetch([{ status: 429, body: paused }]);
    expect(await postSimulatedAnswer("plan_1")).toMatchObject({ ok: false, paused: true });
  });

  it("a re-plan that is paused marks the time busy first, then stops at the cap", async () => {
    const fetchMock = stubFetch([
      { status: 200, body: { data: {}, error: null } },
      { status: 429, body: paused },
    ]);
    expect(await postReplan("plan_1", "a")).toMatchObject({ ok: false, paused: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reads a follow-up's 429 as paused too, and a re-plan of one starts that person again", async () => {
    stubFetch([{ status: 429, body: paused }]);
    expect(await postFollowUp("jules")).toMatchObject({ ok: false, paused: true });

    const fetchMock = stubFetch([
      { status: 200, body: { data: {}, error: null } },
      { status: 200, body: {} },
    ]);
    expect(await postReplan("plan_1", "a", "jules")).toEqual({ ok: true });
    const bodies = fetchMock.mock.calls.map((call) => JSON.parse((call as unknown as [string, { body: string }])[1].body));
    expect(bodies[1]).toEqual({ scenario: "follow_up", target: "jules" });
  });

  it("any other failure stays an error with its message", async () => {
    stubFetch([{ status: 409, body: { error: { message: "Nothing is waiting" } } }]);
    expect(await postSignal()).toEqual({ ok: false, message: "Nothing is waiting" });
  });

  it("a 429 that is not a pause (no paused flag) is still an error", async () => {
    stubFetch([{ status: 429, body: { error: "Too many requests" } }]);
    expect(await postSignal()).toEqual({ ok: false, message: "Too many requests" });
  });
});

describe("asking your own Muse", () => {
  it("posts the question as side a, and counts the answer as arriving in the next snapshot", async () => {
    const fetchMock = stubFetch([{ status: 200, body: { data: { question: { id: "chat_1" }, answer: { id: "chat_2" } }, error: null } }]);
    expect(await postChat("Why Tuesday?")).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/chat");
    expect(JSON.parse(String(init.body))).toEqual({ role: "a", text: "Why Tuesday?" });
  });

  it("reads the chat cap's 429 as paused, so the page falls back to a recording", async () => {
    stubFetch([{ status: 429, body: { paused: true, reason: "room", text: "Live runs paused, playing a recording", budget: { paused: true } } }]);
    expect(await postChat("Why Tuesday?")).toEqual({ ok: false, paused: true, message: "Live runs paused, playing a recording" });
  });

  it("keeps the model's honest reason when the Muse cannot answer", async () => {
    stubFetch([{ status: 503, body: { data: null, error: { message: "Sprout could not answer just now." } } }]);
    expect(await postChat("Why Tuesday?")).toEqual({ ok: false, message: "Sprout could not answer just now." });
  });
});
