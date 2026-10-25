import { productionDeps } from "../_lib/byom";
import { authenticateJudge, toResponse } from "../_lib/judge";
import { linkSentence, mintCode } from "../_lib/keyless";

export const dynamic = "force-dynamic";

// Mints a short link code for the keyless path (/j/<code>): an empty room that lasts 2 hours and starts one plan.
// Closed like the other judge routes: the code stands in for the key, so it needs the key. The /connect page
// mints the same way for the person at the table, behind its own button.
async function mint(request: Request) {
  const denied = authenticateJudge(request);
  if (denied) return denied;
  const outcome = await mintCode(productionDeps());
  if (!outcome.ok) return toResponse(outcome);
  const origin = new URL(request.url).origin;
  const { code, expires_in_minutes } = outcome.value;
  return toResponse({
    ok: true as const,
    value: { code, expires_in_minutes, link: `${origin}/j/${code}`, table_screen: `${origin}/?room=${code}`, sentence: linkSentence(origin, code) },
  });
}

export { mint as GET, mint as POST };
