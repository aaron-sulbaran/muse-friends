import { judgeKeyConfigured, viewLink } from "@/app/api/connector/_lib/keyless";
import { productionDeps } from "@/app/api/connector/_lib/byom";
import { closedPage, errorPage, linkPage } from "../_lib/pages";
import { htmlResponse } from "../_lib/render";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The page a judge's own Muse opens in its built-in browser: the six proposed times to tick, then the plan as it
// stands. Plain HTML, no script, no cookie. Closed (404) unless the judge key is set; 404 for a code that is not
// valid and 410 for one that has expired. Reloading it is how a plan is followed.
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  if (!judgeKeyConfigured()) return htmlResponse(closedPage(), 404);
  const { code } = await params;
  const view = await viewLink(code, productionDeps());
  if (!view.ok) return htmlResponse(errorPage(view), view.status);
  return htmlResponse(linkPage(view.value));
}
