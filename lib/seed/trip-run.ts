import { z } from "zod";
import { MemberId, RecordedRun, type RecordedRun as RecordedRunType } from "@/lib/protocol";
import tripRunFile from "./trip-run.json";

// A trip run recorded on the live model by `pnpm demo:record:trip`: Sprout asks, a model plays Michelle and Kai, the
// coordinator's model composes the outline from the seeded catalog, each person confirms their own deposit, and the
// pot fills. Replay plays this file, so the trip survives a cut live path as a recording and says so. Everything in it
// happened: the messages, the model proof on the coordinator's plan, the answers and who gave them, the ledger ids.

export const TripRunStats = z.strictObject({
  attempts: z.number().int().min(1),
  chosenAttempt: z.number().int().min(1),
  // From the group chat to a confirmed trip, wall clock.
  totalMs: z.number().int().min(0),
  perMessage: z.array(z.strictObject({ seq: z.number().int(), from: MemberId, type: z.string(), at: z.string() })),
});
export type TripRunStats = z.infer<typeof TripRunStats>;

export const TripRunBundle = z.strictObject({
  run: RecordedRun,
  // The model that played the people and composed the outline, as the API named it.
  model: z.string().min(1).max(40),
  stats: TripRunStats,
});
export type TripRunBundle = z.infer<typeof TripRunBundle>;

/** The recording, or null when the file is empty or does not parse. */
export function tripRunBundle(): TripRunBundle | null {
  const parsed = TripRunBundle.safeParse(tripRunFile);
  return parsed.success ? parsed.data : null;
}

/** The recording Replay can play: a confirmed trip whose plan message carries the model's proof. Null otherwise. */
export function recordedTripRun(): RecordedRunType | null {
  const bundle = tripRunBundle();
  if (!bundle) return null;
  const { snapshot } = bundle.run;
  const plan = snapshot.plans.at(-1);
  const planned = snapshot.messages.filter((record) => record.message.type === "trip_plan");
  const usable = plan?.kind === "trip" && plan.state === "confirmed" && planned.length > 0 && planned.every((record) => record.proof !== undefined);
  return usable ? bundle.run : null;
}
