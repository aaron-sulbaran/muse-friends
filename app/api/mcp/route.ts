// /api/mcp is the URL we hand out; /api/mcp/[transport] answers the same requests for clients that
// append a transport segment such as /api/mcp/mcp.
export { GET, POST } from "./[transport]/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
