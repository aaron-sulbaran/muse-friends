import { z } from "zod";
import {
  ActivityEvent,
  MemberId,
  MessageRecord,
  RecordedRun,
  Redaction,
  SharePolicy,
  type RecordedRun as RecordedRunType,
} from "@/lib/protocol";
import liveRunFile from "./live-run.json";
import { shawarmaRun } from "./fixtures";

// A shawarma run recorded live on Muse Spark by `pnpm demo:record`, with the numbers as they happened.
// Replay plays this. The hand-written run in fixtures.ts stays for UI tests and the plan-state snapshots.

// The privacy beat from the same run: a person's sharing setting changed and a message they had already
// sent replayed under it. `before` and `after` are the same message (same id and position).
export const PrivacyBeat = z.strictObject({
  owner: MemberId,
  friend: MemberId,
  policyBefore: SharePolicy,
  policyAfter: SharePolicy,
  before: MessageRecord,
  after: MessageRecord,
  redaction: Redaction,
  events: z.array(ActivityEvent),
});
export type PrivacyBeat = z.infer<typeof PrivacyBeat>;

export const LiveRunStats = z.strictObject({
  attempts: z.number().int().min(1),
  chosenAttempt: z.number().int().min(1),
  timeToAgreementMs: z.number().int().min(0),
  perMessage: z.array(
    z.strictObject({
      seq: z.number().int(),
      from: MemberId,
      type: z.string(),
      arrivalMs: z.number().int(),
      turnMs: z.number().int(),
      callMs: z.number().int(),
      outputTokens: z.number().int(),
      reasoningTokens: z.number().int(),
    }),
  ),
});
export type LiveRunStats = z.infer<typeof LiveRunStats>;

export const LiveRunBundle = z.strictObject({
  run: RecordedRun,
  privacyBeat: PrivacyBeat.nullable(),
  stats: LiveRunStats,
});
export type LiveRunBundle = z.infer<typeof LiveRunBundle>;

export function liveRunBundle(): LiveRunBundle {
  return LiveRunBundle.parse(liveRunFile);
}

export function liveShawarmaRun(): RecordedRunType {
  return liveRunBundle().run;
}

export function livePrivacyBeat(): PrivacyBeat | null {
  return liveRunBundle().privacyBeat;
}

// What Replay plays: the live recording. (The scripted fixture is the fallback if the file is ever empty.)
export function replayRun(): RecordedRunType {
  const bundle = liveRunBundle();
  return bundle.run.snapshot.messages.length > 0 ? bundle.run : shawarmaRun();
}
