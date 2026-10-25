import { productionDeps, respond } from "../_lib/byom";
import { authenticateJudge, badJson, readJson, toResponse } from "../_lib/judge";

export const dynamic = "force-dynamic";
// The simulated friend answers her card with one model call before this returns.
export const maxDuration = 60;

// REST mirror of the MCP tool respond. Body: { planId: string, decision: "accept" | "decline" }.
export async function POST(request: Request) {
  const denied = authenticateJudge(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (body === undefined) return badJson();
  return toResponse(await respond(body, productionDeps()));
}
