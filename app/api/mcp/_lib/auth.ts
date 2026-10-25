import { timingSafeEqual } from "node:crypto";

// Each Muse account that connects gets its own token, mapped to a role (the same A and B as the
// /a and /b phone routes), plus one shared token for a judge's own Muse ("Bring your own Muse").
// All of them come from the environment; an unset or short token never matches, so a missing
// variable fails closed instead of opening the endpoint.
export type McpAccount = "a" | "b" | "judge";

const MIN_TOKEN_LENGTH = 24;

type TokenEnv = Record<string, string | undefined>;

// The accounts that may start, check, and answer a judge's own plan. A and B are the team's tokens
// for get_status only.
export function isJudge(account: McpAccount | string | null | undefined): boolean {
  return account === "judge";
}

// Whether the judge station is switched on: the shared key is set and long enough to be one. Everything that
// a judge can reach (the three tools, /connect, the /j links) stays closed while this is false.
export function judgeKeyConfigured(env: TokenEnv = process.env): boolean {
  return (env.MCP_TOKEN_JUDGE?.length ?? 0) >= MIN_TOKEN_LENGTH;
}

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
  if (tokensMatch(presented, env.MCP_TOKEN_JUDGE)) return "judge";
  return null;
}

export type PresentedCredential = { token: string | undefined; scheme: "bearer" | "raw" | "x-api-key" | "none" };

// Muse's hosted connect flow asks the user for an API key, and we have not seen how it sends it. Accept
// the standard bearer header, the pasted key on its own in Authorization (a dialog that sends the string
// verbatim, as one vendor's did), and the common x-api-key header.
export function readPresentedCredential(request: Request, bearerToken: string | undefined): PresentedCredential {
  if (bearerToken) return { token: bearerToken, scheme: "bearer" };
  const authorization = request.headers.get("authorization")?.trim();
  if (authorization) {
    const [type, value] = authorization.split(/\s+/);
    if (type.toLowerCase() === "bearer" && value) return { token: value, scheme: "bearer" };
    if (!/\s/.test(authorization)) return { token: authorization, scheme: "raw" };
  }
  const apiKey = request.headers.get("x-api-key");
  if (apiKey) return { token: apiKey, scheme: "x-api-key" };
  return { token: undefined, scheme: "none" };
}
