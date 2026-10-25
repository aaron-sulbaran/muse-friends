import { NextResponse } from "next/server";
import { z } from "zod";
import { reserveRun } from "@/lib/agent/caps";
import { decide } from "@/lib/agent/lifecycle";
import { getStore } from "@/lib/store";
import { memberDecides } from "@/lib/ui/group";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.strictObject({ planId: z.string().min(1), member: z.literal("kai").default("kai") });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function refuse(message: string, status: number) {
  return NextResponse.json({ data: null, error: { message } }, { status });
}

/**
 * Kai, the third person of a plan for three, answers their card when a model plays them: the same shape as
 * ../simulated-friend, which answers for Michelle. Only a room that plays alone (the simulated-friend switch) uses
 * it; with a real second phone, Kai answers from the coordinator's phone through ../plans/[id]/member-decision.
 * Any open page may ask; the answer happens once, because the lifecycle refuses a second decision from one person.
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
  if (!(await store.getRoom()).simulatedFriend) return refuse("This room has real people, so Kai answers from the coordinator's phone", 409);
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

  let choice: "accept" | "decline";
  try {
    choice = (await memberDecides(member, plan)).choice;
  } catch (error) {
    return refuse(error instanceof Error ? error.message : "Kai did not answer", 502);
  }
  const result = await decide(store, { planId: plan.id, agent: member, choice });
  if (!result.ok) return refuse(result.error, result.status);
  return NextResponse.json({ data: { choice, plan: result.value.plan }, error: null });
}
