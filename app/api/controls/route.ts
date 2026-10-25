import { NextResponse } from "next/server";
import { z } from "zod";
import { resetDemo, setSharePolicy } from "@/lib/agent/controls";
import { Category, ShareTier } from "@/lib/protocol";
import { getStore } from "@/lib/store";
import { readSnapshot } from "@/lib/ui/source";

export const dynamic = "force-dynamic";

const privacySchema = z
  .object({
    type: z.literal("privacy"),
    /** Whose sharing is changing. Only side b's is switchable in the demo. */
    side: z.literal("b"),
    tier: ShareTier.optional(),
    category: Category.optional(),
    on: z.boolean().optional(),
  })
  .refine((body) => body.tier !== undefined || (body.category !== undefined && body.on !== undefined), {
    message: "Send a tier, or a category with on",
  });

const bodySchema = z.union([privacySchema, z.object({ type: z.literal("reset") })]);

function refuse(message: string, status: number) {
  return NextResponse.json({ data: null, error: { message } }, { status });
}

/** The presenter's controls: a sharing switch on side b, and Reset for the one demo room. */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse("Expected a privacy change or a reset", 400);
  const body = parsed.data;
  const store = await getStore();

  if (body.type === "reset") {
    const { resetCount } = await resetDemo(store);
    return NextResponse.json({ data: { reset: true, resetCount }, error: null });
  }
  if (body.tier === "off") return refuse("Turning sharing off ends the plan, so it stays on in this demo", 409);
  if (body.category === "availability" && body.on === false) {
    return refuse("Free times are how the Muses find a day, so they stay on in this demo", 409);
  }
  const result = await setSharePolicy(store, {
    owner: "lisa",
    friend: "aaron",
    tier: body.tier,
    categories: body.category !== undefined && body.on !== undefined ? { [body.category]: body.on } : undefined,
  });
  if (!result.ok) return refuse(result.error, result.status);
  return NextResponse.json({ data: { sharing: (await readSnapshot()).sharing.lisa, replayed: result.value.replayed.length }, error: null });
}
