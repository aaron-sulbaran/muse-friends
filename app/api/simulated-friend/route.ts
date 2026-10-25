import { NextResponse } from "next/server";
import { z } from "zod";
import { decide } from "@/lib/agent/lifecycle";
import { getStore } from "@/lib/store";
import { michelleDecides } from "@/lib/ui/friend";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ planId: z.string().min(1) });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function refuse(message: string, status: number) {
  return NextResponse.json({ data: null, error: { message } }, { status });
}

/**
 * The simulated friend answers her card. Any open page may ask; the answer happens
 * once, because the lifecycle refuses a second decision from the same person.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse("Expected { planId }", 400);
  const store = await getStore();

  const waiting = async () => {
    const plan = await store.getPlan(parsed.data.planId);
    return plan && plan.state === "awaiting_humans" && plan.decisions.lisa === "pending" ? plan : null;
  };
  if (!(await store.getRoom()).simulatedFriend) return refuse("This room has a real second person", 409);
  const first = await waiting();
  if (!first) return refuse("Nothing is waiting on the simulated friend", 409);

  // A beat, so the person on side a sees the card arrive before the friend answers it.
  await sleep(2200);
  const plan = await waiting();
  if (!plan) return refuse("Nothing is waiting on the simulated friend", 409);

  let choice: "accept" | "decline";
  try {
    choice = (await michelleDecides(plan)).choice;
  } catch (error) {
    return refuse(error instanceof Error ? error.message : "The simulated friend did not answer", 502);
  }
  const result = await decide(store, { planId: plan.id, agent: "lisa", choice });
  if (!result.ok) return refuse(result.error, result.status);
  return NextResponse.json({ data: { choice, plan: result.value.plan }, error: null });
}
