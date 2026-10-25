import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { confirmJoin, driveTrip, isTripPlan, recordAnswer, startTrip } from "@/lib/agent/trip";
import { toCentralIso } from "@/lib/agent/windows";
import { modelId } from "@/lib/model";
import { TripRunBundle } from "@/lib/seed/trip-run";
import { JsonStore } from "@/lib/store/json";
import { modelPlayers } from "@/lib/ui/group-players";

// pnpm demo:record:trip: runs the trip live on the model (Michelle and Kai played by it, the coordinator composing
// from the seeded catalog, the judge answering and joining), keeps the best of a few attempts, and writes it to
// lib/seed/trip-run.json (or DEMO_RECORD_PATH). Replay plays that file as a recording of scenario three, labeled with
// the model that made it. The wire here is in-process, the same code the app runs; nothing is hand-written.

const OUTPUT = process.env.DEMO_RECORD_PATH ?? "lib/seed/trip-run.json";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Attempt = { store: JsonStore; planId: string; totalMs: number; good: boolean };

async function attempt(): Promise<Attempt> {
  const started = Date.now();
  const store = new JsonStore(null);
  await store.putRoom({ ...(await store.getRoom()), simulatedFriend: true });
  const { planId } = await startTrip(store);
  // The judge's own part, a beat apart so the recording has the pace of a person: the answer, then the deposit.
  await sleep(1500);
  await recordAnswer(store, { planId, member: "aaron", answer: "yes", by: "person" });
  await driveTrip(store, planId, modelPlayers);
  await sleep(1500);
  const joined = await confirmJoin(store, { planId, member: "aaron" });
  const plan = await store.getPlan(planId);
  const messages = await store.listMessages();
  const composedByModel = isTripPlan(plan) && plan.trip.itinerary?.composedBy === "model";
  const answersFromModel = isTripPlan(plan) && (["lisa", "kai"] as const).every((member) => plan.trip.answers[member]?.by === "person_model");
  const joinedByModel = isTripPlan(plan) && (["lisa", "kai"] as const).every((member) => plan.trip.pot?.deposits[member]?.by === "person_model");
  const planned = messages.filter((record) => record.message.type === "trip_plan");
  console.log(
    `  joined=${joined.ok} state=${plan?.state} composedBy=${isTripPlan(plan) ? plan.trip.itinerary?.composedBy : "-"} answers=${isTripPlan(plan) ? JSON.stringify(Object.fromEntries(Object.entries(plan.trip.answers).map(([member, answer]) => [member, answer?.by]))) : "-"} plans=${messages.filter((record) => record.message.type === "trip_plan").length} proofs=${messages.filter((record) => record.message.type === "trip_plan" && record.proof).length}${joined.ok ? "" : ` error=${joined.error}`}`,
  );
  if (!joined.ok) {
    console.log(`  history: ${JSON.stringify(plan?.history.map((entry) => `${entry.state}${entry.note ? ` (${entry.note})` : ""}`))}`);
    console.log(`  events: ${(await store.snapshot()).events.map((event) => event.text).slice(-8).join(" | ")}`);
  }
  const good = joined.ok && plan?.state === "confirmed" && composedByModel && answersFromModel && joinedByModel && planned.length === 2 && planned.every((record) => record.proof !== undefined);
  return { store, planId, totalMs: Date.now() - started, good };
}

it("records the trip live and keeps the best run for Replay", async () => {
  const wanted = Number(process.env.DEMO_ATTEMPTS ?? 2);
  const attempts: Attempt[] = [];
  for (let number = 1; number <= 4; number += 1) {
    const result = await attempt();
    attempts.push(result);
    console.log(`attempt ${number}: ${result.good ? "good" : "not good"} in ${(result.totalMs / 1000).toFixed(1)}s`);
    if (attempts.length >= wanted && attempts.some((entry) => entry.good)) break;
  }
  const best = attempts.filter((entry) => entry.good).sort((a, b) => a.totalMs - b.totalMs)[0];
  if (!best) throw new Error("no attempt produced a trip composed, answered and joined by the model; nothing was written");
  const snapshot = await best.store.snapshot();
  const bundle = TripRunBundle.parse({
    run: {
      id: "run_trip_live",
      label: "Trip for three (recorded live on Muse Spark)",
      scenario: "trip",
      source: "live",
      recordedAt: toCentralIso(Date.now()),
      snapshot,
    },
    model: modelId(),
    stats: {
      attempts: attempts.length,
      chosenAttempt: attempts.indexOf(best) + 1,
      totalMs: best.totalMs,
      perMessage: snapshot.messages.map((record) => ({ seq: record.message.seq, from: record.message.from, type: record.message.type, at: record.message.at })),
    },
  });
  writeFileSync(OUTPUT, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`DEMO RECORD TRIP: kept attempt ${bundle.stats.chosenAttempt} of ${attempts.length} (${(best.totalMs / 1000).toFixed(1)}s, ${snapshot.messages.length} messages, model ${bundle.model}); wrote ${OUTPUT}`);
}, 600_000);
