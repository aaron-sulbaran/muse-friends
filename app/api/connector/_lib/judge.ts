import { isJudge, readPresentedCredential, resolveMcpAccount } from "@/app/api/mcp/_lib/auth";
import type { Failure, Outcome } from "./byom";

const baseHeaders = { "Cache-Control": "no-store" };

// The REST mirror of the judge tools shares one rule with the MCP tools: only the shared judge key
// (MCP_TOKEN_JUDGE) may start, check, or answer a plan. With that variable unset nothing can match, so every
// route answers 401. The team's own keys (A and B) are valid but only for get_status, so they get 403.
export function authenticateJudge(request: Request): Response | null {
  const authorization = request.headers.get("authorization");
  const [type, bearer] = authorization?.split(" ") ?? [];
  const { token, scheme } = readPresentedCredential(request, type?.toLowerCase() === "bearer" ? bearer : undefined);
  const account = resolveMcpAccount(token);
  // Never log the token; the scheme and user agent show how Muse sends the key.
  console.log(`judge auth scheme=${scheme} accepted=${isJudge(account)} ua=${request.headers.get("user-agent")?.slice(0, 80) ?? "none"}`);
  if (account === null) {
    return Response.json({ data: null, error: { code: "unauthorized", message: "A valid key is required" } }, { status: 401, headers: { ...baseHeaders, "WWW-Authenticate": 'Bearer realm="muse-friends"' } });
  }
  if (!isJudge(account)) {
    return Response.json({ data: null, error: { code: "forbidden", message: "This key can only call get_status" } }, { status: 403, headers: baseHeaders });
  }
  return null;
}

export function failureBody(failure: Failure) {
  return { code: failure.code, message: failure.message };
}

export function toResponse<T>(outcome: Outcome<T>, successStatus = 200): Response {
  if (outcome.ok) return Response.json({ data: outcome.value, error: null }, { status: successStatus, headers: baseHeaders });
  const headers: Record<string, string> = { ...baseHeaders };
  if (outcome.retryAfterSeconds) headers["Retry-After"] = String(outcome.retryAfterSeconds);
  return Response.json({ data: null, error: failureBody(outcome) }, { status: outcome.status, headers });
}

export async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => undefined);
}

export function badJson(): Response {
  return Response.json({ data: null, error: { code: "bad_input", message: "The body must be JSON" } }, { status: 400, headers: baseHeaders });
}
