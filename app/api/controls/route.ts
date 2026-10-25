import { NextResponse } from "next/server";
import { z } from "zod";
import { categoriesForTier, resetDemo, setSharePolicy } from "@/lib/agent/controls";
import { Category, ShareTier } from "@/lib/protocol";
import { getStore } from "@/lib/store";
import { readSnapshot } from "@/lib/ui/source";

export const dynamic = "force-dynamic";

const privacySchema = z
  .object({
    type: z.literal("privacy"),
    /** Whose sharing is changing: b is the friend's Muse, a is the judge's own (onboarding sets it). */
    side: z.enum(["a", "b"]),
    tier: ShareTier.optional(),
    category: Category.optional(),
    on: z.boolean().optional(),
  })
  .refine((body) => body.tier !== undefined || (body.category !== undefined && body.on !== undefined), {
    message: "Send a tier, or a category with on",
  });

const bodySchema = z.union([
  privacySchema,
  z.object({ type: z.literal("reset") }),
  z.object({ type: z.literal("simulated_friend"), on: z.boolean() }),
]);

const sharers = { a: { owner: "aaron", friend: "lisa" }, b: { owner: "lisa", friend: "aaron" } } as const;

function refuse(message: string, status: number) {
  return NextResponse.json({ data: null, error: { message } }, { status });
}

/** The controls: a sharing switch on either side, Reset for the one demo room, and the simulated friend for a judge playing alone. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse("Expected a privacy change or a reset", 400);
  const body = parsed.data;
  const store = await getStore();

  if (body.type === "reset") {
    const { resetCount } = await resetDemo(store);
    return NextResponse.json({ data: { reset: true, resetCount }, error: null });
  }
  if (body.type === "simulated_friend") {
    // Switching who plays side b starts the room over, so the judge begins from the empty stage.
    const { resetCount } = await resetDemo(store, { simulatedFriend: body.on });
    return NextResponse.json({ data: { simulatedFriend: body.on, resetCount }, error: null });
  }
  if (body.tier === "off") return refuse("Turning sharing off ends the plan, so it stays on in this demo", 409);
  if (body.category === "availability" && body.on === false) {
    return refuse("Free times are how the Muses find a day, so they stay on in this demo", 409);
  }
  const { owner, friend } = sharers[body.side];
  const result = await setSharePolicy(store, {
    owner,
    friend,
    tier: body.tier,
    // Picking a tier refills every switch from it; flipping one switch changes that category alone.
    categories: body.category !== undefined && body.on !== undefined ? { [body.category]: body.on } : body.tier !== undefined ? categoriesForTier(body.tier) : undefined,
  });
  if (!result.ok) return refuse(result.error, result.status);
  return NextResponse.json({ data: { sharing: (await readSnapshot()).sharing[owner], replayed: result.value.replayed.length }, error: null });
}
