import type { AuthInfo } from "@modelcontextprotocol/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { z } from "zod";
import {
  CheckPlanInput,
  RespondInput,
  StartPlanInput,
  checkPlan,
  productionDeps,
  respond,
  startPlan,
  type Outcome,
} from "@/app/api/connector/_lib/byom";
import { failureBody } from "@/app/api/connector/_lib/judge";
import { isJudge, readPresentedCredential, resolveMcpAccount, type McpAccount } from "../_lib/auth";
import { buildStatus, readStoreSummary } from "../_lib/status";

export const dynamic = "force-dynamic";
// start_plan runs the agents' conversation after the response, inside this function's time limit.
export const maxDuration = 300;

// What a tool answers: the result as JSON text, or the same shape the REST mirror uses for an error.
function reply<T>(outcome: Outcome<T>) {
  if (outcome.ok) return { content: [{ type: "text" as const, text: JSON.stringify(outcome.value, null, 2) }] };
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: failureBody(outcome) }, null, 2) }] };
}

const notForThisKey = {
  isError: true,
  content: [{ type: "text" as const, text: JSON.stringify({ error: { code: "forbidden", message: "This key can only call get_status" } }) }],
};

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

    // Bring your own Muse: three tools for the shared judge key (MCP_TOKEN_JUDGE). They run in a room of
    // their own, never the demo room. With the key unset nothing can authenticate as a judge.
    server.registerTool(
      "start_plan",
      {
        title: "Start a plan with Mochi",
        description:
          "Start a plan between the person's Sprout agent and Mochi, a fictional friend played by a model. Send 1 to 3 free windows, whole hours between 09:00 and 22:00 US Central, inside the next 7 days and Oct 25 to Oct 31, as { day: 'YYYY-MM-DD', start: 'HH:00', end: 'HH:00' }, and optionally reel_hint, one line (at most 140 characters) about what they would like to do. Only those windows and the hint are used: no calendar, contacts, or messages are read. Returns a planId; then call check_plan.",
        inputSchema: StartPlanInput,
      },
      async (args, ctx) => (isJudge(ctx.http?.authInfo?.clientId) ? reply(await startPlan(args, productionDeps())) : notForThisKey),
    );
    server.registerTool(
      "check_plan",
      {
        title: "Check a plan",
        description:
          "Where the plan stands: negotiating, awaiting_you (Sprout and Mochi agreed; shows the agreed window and a drafted WhatsApp message), waiting_for_mochi, confirmed, dropped, or stalled, with the messages so far (who, type, note, and what the sharing policy let through or withheld). Read-only.",
        inputSchema: CheckPlanInput,
      },
      async (args, ctx) => (isJudge(ctx.http?.authInfo?.clientId) ? reply(await checkPlan(args, productionDeps())) : notForThisKey),
    );
    server.registerTool(
      "respond",
      {
        title: "Answer for the person",
        description:
          "The person's own decision on the plan, only after check_plan says awaiting_you and the person has said so: accept or decline. Accepting lets Mochi answer her card; the drafted message is for the person to send themselves in WhatsApp (nothing is sent for them).",
        inputSchema: RespondInput,
      },
      async (args, ctx) => (isJudge(ctx.http?.authInfo?.clientId) ? reply(await respond(args, productionDeps())) : notForThisKey),
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
