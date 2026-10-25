import { NextResponse } from "next/server";
import { z } from "zod";
import { withRoom, withoutRoom } from "@/app/api/_lib/room";
import { categoriesForTier, resetDemo, setPayments, setSharePolicy } from "@/lib/agent/controls";
import { otherAgent } from "@/lib/agent/ids";
import { Category, PAYMENT_MAX_DOLLARS, ShareTier } from "@/lib/protocol";
import { ROLE_TO_AGENT } from "@/lib/seed/fixtures";
import { toUiSnapshot } from "@/lib/ui/snapshot";
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

/** Lets a person's Muse settle up with their friend, up to a cap per plan, or switches it off. Either side may. */
const paymentsSchema = z.object({
  type: z.literal("payments"),
  side: z.enum(["a", "b"]),
  enabled: z.boolean(),
  /** Whole dollars per plan; when on and left out, the last cap is kept (20 the first time). */
  cap: z.number().int().min(0).max(PAYMENT_MAX_DOLLARS).optional(),
});

const bodySchema = z.union([
  privacySchema,
  paymentsSchema,
  z.object({ type: z.literal("reset") }),
  z.object({ type: z.literal("simulated_friend"), on: z.boolean() }),
]);

function refuse(message: string, status: number) {
  return NextResponse.json({ data: null, error: { message } }, { status });
}

const CAP_TEXT = `The cap is whole dollars per plan, from 0 to ${PAYMENT_MAX_DOLLARS}`;

// What was wrong with a body that did not parse, named for the control it was aimed at (a payments body with a bad cap
// says so, instead of asking for a privacy change).
function badBodyMessage(raw: unknown): string {
  const body = (typeof raw === "object" && raw !== null ? raw : {}) as { type?: unknown; cap?: unknown };
  if (body.type === "payments") {
    const capOk = body.cap === undefined || (Number.isInteger(body.cap) && (body.cap as number) >= 0 && (body.cap as number) <= PAYMENT_MAX_DOLLARS);
    return capOk ? "Payments need a side (a or b) and enabled (true or false), and may carry a cap in whole dollars" : CAP_TEXT;
  }
  return "Expected a privacy change, a payments change (side, enabled, cap), a reset, or the simulated friend switch";
}

/** The controls: a sharing switch on either side, payments, Reset for the one demo room, and the simulated friend for a judge playing alone. */
export async function POST(request: Request) {
  const raw = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(withoutRoom(raw));
  if (!parsed.success) return refuse(badBodyMessage(withoutRoom(raw)), 400);
  const body = parsed.data;
  // Reset and the simulated friend switch act on the room the call names (?room=) and on no other.
  return withRoom(request, raw, { mint: true }, async (room) => {
    const store = room.store;

    if (body.type === "reset") {
      const { resetCount } = await resetDemo(store);
      return NextResponse.json({ data: { reset: true, resetCount }, error: null });
    }
    if (body.type === "simulated_friend") {
      // Switching who plays side b starts the room over, so the judge begins from the empty stage.
      const { resetCount } = await resetDemo(store, { simulatedFriend: body.on });
      return NextResponse.json({ data: { simulatedFriend: body.on, resetCount }, error: null });
    }
    if (body.type === "payments") {
      const owner = ROLE_TO_AGENT[body.side];
      const result = await setPayments(store, { owner, friend: otherAgent(owner), enabled: body.enabled, capPerPlan: body.cap });
      if (!result.ok) return refuse(result.error, result.status);
      return NextResponse.json({ data: { payments: result.value.policy.payments }, error: null });
    }
    if (body.tier === "off") return refuse("Turning sharing off ends the plan, so it stays on in this demo", 409);
    if (body.category === "availability" && body.on === false) {
      return refuse("Free times are how the Muses find a day, so they stay on in this demo", 409);
    }
    const owner = ROLE_TO_AGENT[body.side];
    const friend = otherAgent(owner);
    const result = await setSharePolicy(store, {
      owner,
      friend,
      tier: body.tier,
      // Picking a tier refills every switch from it; flipping one switch changes that category alone.
      categories: body.category !== undefined && body.on !== undefined ? { [body.category]: body.on } : body.tier !== undefined ? categoriesForTier(body.tier) : undefined,
    });
    if (!result.ok) return refuse(result.error, result.status);
    const sharing = room.isDemo ? (await readSnapshot()).sharing[owner] : toUiSnapshot(await store.snapshot(), { mode: "live" }).sharing[owner];
    return NextResponse.json({ data: { sharing, replayed: result.value.replayed.length }, error: null });
  });
}
