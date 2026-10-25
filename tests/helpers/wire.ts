// Routes fetches to the app's own inbox to the route handler, so agent-to-agent POSTs run the real
// inbox code without a server. Everything else goes to the real fetch.
export function installWireShim(): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const match = /^\/api\/agents\/([^/]+)\/inbox$/.exec(url.pathname);
    if (!match) return realFetch(input, init);
    const { POST } = await import("@/app/api/agents/[id]/inbox/route");
    return POST(new Request(url, init), { params: Promise.resolve({ id: match[1] }) });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}
