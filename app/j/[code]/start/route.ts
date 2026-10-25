import { productionDeps } from "@/app/api/connector/_lib/byom";
import { judgeKeyConfigured, normalizeCode, startFromPicks, viewLink } from "@/app/api/connector/_lib/keyless";
import { candidateRows, closedPage, errorPage, pickPage } from "../../_lib/pages";
import { htmlResponse, redirectTo } from "../../_lib/render";

export const dynamic = "force-dynamic";
// The two agents talk after the response is sent, inside this function's time limit.
export const maxDuration = 300;

// The native form on /j/<code>: the ticked boxes (name "slot") start the plan, then the browser is sent back to
// the page with a 303 so a reload never sends the form twice. Refusals come back as the same page with the reason.
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!judgeKeyConfigured()) return htmlResponse(closedPage(), 404);
  const { code } = await params;
  const form = await request.formData().catch(() => null);
  const outcome = await startFromPicks(code, form ? form.getAll("slot") : [], productionDeps());
  const here = `/j/${normalizeCode(code) ?? code}`;
  if (outcome.ok || outcome.code === "already_started") return redirectTo(here);
  if (outcome.status === 404 || outcome.status === 410) return htmlResponse(errorPage(outcome), outcome.status);
  const view = await viewLink(code, productionDeps());
  const minutesLeft = view.ok ? view.value.minutesLeft : 1;
  return htmlResponse(pickPage(normalizeCode(code) ?? code, candidateRows(), minutesLeft, outcome.message), outcome.status);
}
