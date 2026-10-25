import { AgentId } from "@/lib/protocol";
import { getPersona } from "@/lib/seed/fixtures";

// The agent card, pinned to A2A v0.3 field names (current A2A docs show v1.0 names, which are not
// used here). The inbox is a plain bearer-authenticated HTTP endpoint, not the A2A methods, so this
// card says A2A-shaped and nothing more.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = AgentId.safeParse((await params).id);
  if (!id.success) return Response.json({ error: "unknown agent" }, { status: 404 });

  const origin = new URL(request.url).origin;
  const persona = getPersona(id.data);
  const card = {
    protocolVersion: "0.3.0",
    name: `${persona.displayName}, a Muse Friends agent`,
    description:
      `The Muse agent for one person. It coordinates plans with friends' agents over a bearer-authenticated HTTP inbox using structured messages ` +
      `(intent, propose, counter, accept, decline). A2A-shaped, not A2A-compliant. A concept demo, not a shipped Muse feature.`,
    url: `${origin}/api/agents/${id.data}/inbox`,
    preferredTransport: "HTTP+JSON",
    version: "0.1.0",
    provider: { organization: "Muse Friends (HackTX 2026 concept)", url: origin },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: [
      {
        id: "coordinate-plan",
        name: "Coordinate a plan",
        description: "Agree a time and activity with a friend's agent using only what the owner's sharing policy allows; the humans decide.",
        tags: ["scheduling", "friends", "privacy"],
        examples: ["Lisa sent a reel of a shawarma place; find a time we are both free."],
        inputModes: ["application/json"],
        outputModes: ["application/json"],
      },
    ],
    securitySchemes: { agentBearer: { type: "http", scheme: "bearer", description: "Each agent sends its own bearer token; the inbox maps it to the sender." } },
    security: [{ agentBearer: [] }],
  };
  return Response.json(card, { headers: { "cache-control": "public, max-age=300" } });
}
