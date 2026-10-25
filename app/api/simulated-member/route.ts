import { NextResponse } from "next/server";
import { z } from "zod";
import { reserveRun } from "@/lib/agent/caps";
import { decide } from "@/lib/agent/lifecycle";
import { newId } from "@/lib/agent/ids";
import { toCentralIso } from "@/lib/agent/windows";
import { getStore } from "@/lib/store";
import { memberDecides } from "@/lib/ui/group-players";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.strictObject({ planId: z.string().min(1), member: z.literal("kai").default("kai") });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function refuse(message: string, status: number) {
  return NextResponse.json({ data: null, error: { message } }, { status });
}

/**
 * Kai, the third person of a plan for three, has their decision made by a model: the same shape as ../simulated-friend,
 * which answers for Michelle. Kai is fictional and has no phone in any room, so this does not wait on the
 * simulated-friend switch. If the model does not answer, Kai's seeded profile (yes) answers and the timeline says so,
 * so a flaky model cannot stall the plan. Any open page may ask; the answer happens once, because the lifecycle refuses
 * a second decision from one person.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse("Expected { planId, member: kai }", 400);
  const { planId, member } = parsed.data;
  const store = await getStore();

  const waiting = async () => {
    const plan = await store.getPlan(planId);
    return plan && plan.state === "awaiting_humans" && plan.group?.decisions[member] === "pending" ? plan : null;
  };
  if ((await store.getPlan(planId))?.kind === "trip") return refuse("A trip's people answer through the trip", 409);
  if (!(await waiting())) return refuse("Nothing is waiting on Kai", 409);

  // A beat longer than Michelle's, so the two answers land one after the other on the coordinator's screen.
  await sleep(3600);
  const plan = await waiting();
  if (!plan) return refuse("Nothing is waiting on Kai", 409);

  // Kai's answer is a model call, so it counts against the same live-run caps as the agents' turns.
  const slot = reserveRun();
  if (!slot.ok) {
    return NextResponse.json(
      { data: null, error: { message: slot.text }, paused: true, reason: slot.reason, text: slot.text, budget: slot.budget },
      { status: 429, headers: { "Retry-After": String(slot.budget.retryAfterSeconds ?? 60) } },
    );
  }

  let choice: "accept" | "decline" = "accept";
  let seeded = false;
  try {
    choice = (await memberDecides(member, plan)).choice;
  } catch (error) {
    console.error("Kai's model did not answer; the seeded profile answers", error);
    seeded = true;
  }
  const result = await decide(store, { planId: plan.id, agent: member, choice });
  if (!result.ok) return refuse(result.error, result.status);
  if (seeded) {
    const at = toCentralIso(Date.now());
    await store.appendEvent({
      id: newId("evt"),
      at,
      kind: "human_decision",
      actor: "agent",
      contextId: plan.contextId,
      planId: plan.id,
      text: "Kai said yes from the seeded profile: the model that plays Kai did not answer",
    });
  }
  return NextResponse.json({ data: { choice, seeded, plan: result.value.plan }, error: null });
}
