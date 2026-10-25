import { productionDeps } from "@/app/api/connector/_lib/byom";
import { answerFromPage, judgeKeyConfigured, normalizeCode } from "@/app/api/connector/_lib/keyless";
import { closedPage, errorPage } from "../../_lib/pages";
import { htmlResponse, redirectTo } from "../../_lib/render";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The native Approve and Decline buttons on /j/<code> (name "decision", value accept or decline). After an
// accept, Mochi answers inside this request; then the browser is sent back to the page, which shows the result.
export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!judgeKeyConfigured()) return htmlResponse(closedPage(), 404);
  const { code } = await params;
  const form = await request.formData().catch(() => null);
  const outcome = await answerFromPage(code, form?.get("decision"), productionDeps());
  const here = `/j/${normalizeCode(code) ?? code}`;
  if (outcome.ok || outcome.status === 409 || outcome.status === 400) return redirectTo(here);
  return htmlResponse(errorPage(outcome), outcome.status);
}
