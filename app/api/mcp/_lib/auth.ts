import { timingSafeEqual } from "node:crypto";

// Each Muse account that connects gets its own token, mapped to a role (the same A and B as the
// /a and /b phone routes). Both tokens come from the environment; an unset or short token never
// matches, so a missing variable fails closed instead of opening the endpoint.
export type McpAccount = "a" | "b";

const MIN_TOKEN_LENGTH = 24;

type TokenEnv = Record<string, string | undefined>;

function tokensMatch(presented: string, expected: string | undefined): boolean {
  if (!expected || expected.length < MIN_TOKEN_LENGTH) return false;
  const presentedBytes = Buffer.from(presented);
  const expectedBytes = Buffer.from(expected);
  return presentedBytes.length === expectedBytes.length && timingSafeEqual(presentedBytes, expectedBytes);
}

export function resolveMcpAccount(presented: string | undefined, env: TokenEnv = process.env): McpAccount | null {
  if (!presented) return null;
  if (tokensMatch(presented, env.MCP_TOKEN_A)) return "a";
  if (tokensMatch(presented, env.MCP_TOKEN_B)) return "b";
  return null;
}

export type PresentedCredential = { token: string | undefined; scheme: "bearer" | "x-api-key" | "none" };

// Muse's hosted connect flow asks the user for an API key, and we have not seen which header it
// sends it in. Accept the standard bearer header and the common x-api-key header.
export function readPresentedCredential(request: Request, bearerToken: string | undefined): PresentedCredential {
  if (bearerToken) return { token: bearerToken, scheme: "bearer" };
  const apiKey = request.headers.get("x-api-key");
  if (apiKey) return { token: apiKey, scheme: "x-api-key" };
  return { token: undefined, scheme: "none" };
}
