import { fallbackModelIds, modelId } from "@/lib/model";

export const dynamic = "force-dynamic";

/** Up, which build, and which models the agents call: the configured one first, then the fallbacks tried when it answers 404. */
export function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local";
  return Response.json({ ok: true, sha, model: modelId(), fallbackModels: fallbackModelIds() }, { headers: { "Cache-Control": "no-store" } });
}
