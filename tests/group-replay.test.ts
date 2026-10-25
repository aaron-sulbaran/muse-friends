import { describe, expect, it } from "vitest";
import { GET as getReplay } from "@/app/api/replay/route";
import { recordedTripRun, tripRunBundle } from "@/lib/seed/trip-run";
import { viewForRole } from "@/lib/ui/chat";
import { buildReplay } from "@/lib/ui/replay";

// The recorded trip is a real run on the live model, played back from the file. Every frame must say it is a recording,
// say which model made it, and show the trip only as far as it had got by then.

const bundle = tripRunBundle();
const run = recordedTripRun();

describe("the recorded trip", () => {
  it("is a real run: a confirmed trip, composed by the model, with the model's proof on the plan", () => {
    expect(bundle).not.toBeNull();
    expect(run).not.toBeNull();
    const plan = run!.snapshot.plans.at(-1)!;
    expect(plan).toMatchObject({ kind: "trip", state: "confirmed" });
    expect(plan.trip!.itinerary!.composedBy).toBe("model");
    expect(Object.values(plan.trip!.answers).filter((answer) => answer?.by === "person_model")).toHaveLength(2);
    expect(run!.snapshot.messages.filter((record) => record.message.type === "trip_plan").every((record) => record.proof?.model)).toBe(true);
    expect(run!.source).toBe("live");
    expect(bundle!.model).toMatch(/^muse-spark/);
  });

  it("plays as frames that grow: answers, then the cap, then the outline and pot, then the deposits", () => {
    const replay = buildReplay(run!, { model: bundle!.model });
    const trips = replay.frames.map((frame) => frame.snapshot.plan?.trip ?? null);
    expect(replay.frames.length).toBeGreaterThanOrEqual(6);
    expect(replay.frames[0].snapshot.plan).toBeNull();
    expect(replay.frames.every((frame) => frame.snapshot.mode === "replay")).toBe(true);
    expect(replay.frames.every((frame) => frame.snapshot.recording?.model === bundle!.model)).toBe(true);

    const firstWith = (test: (trip: NonNullable<(typeof trips)[number]>) => boolean) => trips.findIndex((trip) => trip !== null && test(trip));
    const answered = firstWith((trip) => trip.answers.length > 0);
    const capped = firstWith((trip) => trip.cap !== null);
    const outlined = firstWith((trip) => trip.itinerary !== null);
    const potted = firstWith((trip) => trip.pot !== null);
    const funded = firstWith((trip) => (trip.pot?.balance ?? 0) > 0);
    expect(answered).toBeGreaterThanOrEqual(0);
    expect(capped).toBeGreaterThan(answered);
    expect(outlined).toBeGreaterThanOrEqual(capped);
    expect(potted).toBe(outlined);
    expect(funded).toBeGreaterThan(potted);

    // The pot only ever goes up, one deposit at a time, to the target; a deposit is "in" only once its frame is reached.
    const balances = trips.flatMap((trip) => (trip?.pot ? [trip.pot.balance ?? 0] : []));
    expect([...balances].sort((a, b) => a - b)).toEqual(balances);
    const last = trips.at(-1)!;
    expect(last.pot!.balance).toBe(last.pot!.target);
    expect(last.pot!.deposits.every((deposit) => deposit.status === "confirmed")).toBe(true);
    expect(replay.frames.at(-1)!.snapshot.plan!.state).toBe("confirmed");
  });

  it("draws every frame as the thread without throwing, and never shows the pot card before the outline", () => {
    const replay = buildReplay(run!, { model: bundle!.model });
    for (const frame of replay.frames) {
      for (const role of ["a", "b"] as const) {
        const view = viewForRole(frame.snapshot, role);
        const kinds = view.items.map((item) => item.kind);
        if (kinds.includes("trip-pot")) expect(kinds).toContain("trip-itinerary");
      }
    }
  });

  it("is served by the replay route with its model, and a missing recording is a plain 404", async () => {
    const response = await getReplay(new Request("http://localhost/api/replay?scenario=trip"));
    const body = (await response.json()) as { data: { frames: Array<{ snapshot: { recording?: { model?: string } } }> } };
    expect(response.status).toBe(200);
    expect(body.data.frames.at(-1)!.snapshot.recording?.model).toBe(bundle!.model);
  });
});
