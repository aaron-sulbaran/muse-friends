import { readPresentedCredential, resolveMcpAccount } from "@/app/api/mcp/_lib/auth";
import { buildStatus, readStoreSummary } from "@/app/api/mcp/_lib/status";

export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

// A plain REST mirror of the MCP tool get_status, for a Muse connector builder that only speaks
// REST. Same keys as the MCP endpoint (MCP_TOKEN_A and MCP_TOKEN_B), same fail-closed behavior:
// with no token configured, or a wrong one, the answer is always 401.
export async function GET(request: Request) {
  const authorization = request.headers.get("authorization");
  const [type, bearer] = authorization?.split(" ") ?? [];
  const { token, scheme } = readPresentedCredential(request, type?.toLowerCase() === "bearer" ? bearer : undefined);
  const account = resolveMcpAccount(token);
  // Never log the token; the scheme and user agent show how Muse sends the key.
  console.log(
    `connector auth scheme=${scheme} accepted=${account !== null} ua=${request.headers.get("user-agent")?.slice(0, 80) ?? "none"}`,
  );
  if (!account) {
    return Response.json(
      { data: null, error: { message: "A valid key is required" } },
      { status: 401, headers: { ...headers, "WWW-Authenticate": 'Bearer realm="muse-friends"' } },
    );
  }
  return Response.json({ data: buildStatus(account, await readStoreSummary()), error: null }, { headers });
}
