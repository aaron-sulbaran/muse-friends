import { checkPlan, productionDeps } from "../_lib/byom";
import { authenticateJudge, badJson, readJson, toResponse } from "../_lib/judge";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// REST mirror of the MCP tool check_plan. GET /api/connector/check_plan?planId=..., or POST { planId }.
export async function GET(request: Request) {
  const denied = authenticateJudge(request);
  if (denied) return denied;
  return toResponse(await checkPlan({ planId: new URL(request.url).searchParams.get("planId") ?? "" }, productionDeps()));
}

export async function POST(request: Request) {
  const denied = authenticateJudge(request);
  if (denied) return denied;
  const body = await readJson(request);
  if (body === undefined) return badJson();
  return toResponse(await checkPlan(body, productionDeps()));
}
