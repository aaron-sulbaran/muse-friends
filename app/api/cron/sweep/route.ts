import { timingSafeEqual } from "node:crypto";
import { getStore } from "@/lib/store";
import { sweepPlans } from "./_lib/sweep";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const headers = { "Cache-Control": "no-store" };
const MIN_SECRET_LENGTH = 16;

function bearerMatches(authorization: string | null, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const presented = Buffer.from(authorization ?? "");
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

// Vercel Cron calls this with `Authorization: Bearer <CRON_SECRET>` once a day (the Hobby plan's
// limit). Closed by default: with CRON_SECRET unset or too short the answer is 503, never a run.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    return Response.json({ data: null, error: { message: "CRON_SECRET is not set" } }, { status: 503, headers });
  }
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return Response.json(
      { data: null, error: { message: "Unauthorized" } },
      { status: 401, headers: { ...headers, "WWW-Authenticate": 'Bearer realm="cron"' } },
    );
  }
  const result = await sweepPlans(await getStore(), Date.now());
  return Response.json({ data: result, error: null }, { headers });
}
