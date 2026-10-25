import { productionDeps, startPlan } from "../_lib/byom";
import { authenticateJudge, badJson, readJson, toResponse } from "../_lib/judge";

export const dynamic = "force-dynamic";
// The agents' conversation runs after the response, inside this function's time limit.
export const maxDuration = 300;

// REST mirror of the MCP tool start_plan. Body: { reel_hint?: string, free_windows: [{ day, start, end }] }.
export async function POST(request: Request) {
  const denied = authenticateJudge(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (body === undefined) return badJson();
  return toResponse(await startPlan(body, productionDeps()), 202);
}
