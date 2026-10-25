import { afterEach, describe, expect, it, vi } from "vitest";
import { postReplan, postSignal, postSimulatedAnswer } from "@/lib/ui/actions";

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

  it("any other failure stays an error with its message", async () => {
    stubFetch([{ status: 409, body: { error: { message: "Nothing is waiting" } } }]);
    expect(await postSignal()).toEqual({ ok: false, message: "Nothing is waiting" });
  });

  it("a 429 that is not a pause (no paused flag) is still an error", async () => {
    stubFetch([{ status: 429, body: { error: "Too many requests" } }]);
    expect(await postSignal()).toEqual({ ok: false, message: "Too many requests" });
  });
});
