import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import { readPresentedCredential, resolveMcpAccount, type McpAccount } from "../_lib/auth";
import { buildStatus, readStoreSummary } from "../_lib/status";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const mcpHandler = createMcpHandler(
  (server) => {
    server.registerTool(
      "get_status",
      {
        title: "Get Muse Friends status",
        description:
          "Reports whether the Muse Friends service and its store are reachable, which connector account this key belongs to, and counts of the stored threads, messages, plans, cards, and activity events (never their content). Takes no arguments and changes nothing.",
        inputSchema: z.object({}),
      },
      async (_args, ctx) => {
        const account = (ctx.http?.authInfo?.clientId ?? "a") as McpAccount;
        const status = buildStatus(account, await readStoreSummary());
        return { content: [{ type: "text", text: JSON.stringify(status, null, 2) }] };
      },
    );
  },
  { serverInfo: { name: "muse-friends", version: "0.1.0" } },
);

async function verifyToken(request: Request, bearerToken: string | undefined): Promise<AuthInfo | undefined> {
  const { token, scheme } = readPresentedCredential(request, bearerToken);
  const account = resolveMcpAccount(token);
  // Never log the token. The scheme and user agent are what we need to learn how Muse sends the key.
  console.log(
    `mcp auth scheme=${scheme} accepted=${account !== null} ua=${request.headers.get("user-agent")?.slice(0, 80) ?? "none"}`,
  );
  if (!account || !token) return undefined;
  return { token, clientId: account, scopes: ["muse-friends"] };
}

const authedHandler = withMcpAuth(mcpHandler, verifyToken, { required: true, requiredScopes: ["muse-friends"] });

export { authedHandler as GET, authedHandler as POST };
