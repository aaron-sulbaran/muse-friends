export const dynamic = "force-dynamic";

export function GET() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local";
  return Response.json({ ok: true, sha }, { headers: { "Cache-Control": "no-store" } });
}
