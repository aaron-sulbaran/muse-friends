import { agentToken } from "@/lib/agent/wire";

/*
 * "Try to leak": two forged sends to Mochi's inbox through the ordinary HTTP path, so a judge can watch the
 * code say no. Server-only, because the second one needs Sprout's bearer token, which never leaves the server.
 * Nothing here weakens or bypasses a check: it only sends what a misbehaving agent could send.
 */

export type LeakAttempt = {
  id: "wrong_bearer" | "private_note";
  /** What was tried, in a phrase. */
  label: string;
  /** The inbox's HTTP status; 0 when the request never got an answer. */
  status: number;
  /** The inbox's own error text, verbatim. */
  error: string;
  /** True when the inbox refused (4xx), which is the point. */
  rejected: boolean;
};

type Deliver = (url: string, init: RequestInit) => Promise<Response>;

/** A well-formed first message from Sprout to Mochi, except that its note names an event on Sprout's private calendar. */
export function forgedMessage(now: number = Date.now()) {
  const stamp = now.toString(36);
  return {
    id: `msg_forged_${stamp}`,
    contextId: `ctx_forged_${stamp}`,
    seq: 1,
    from: "aaron",
    to: "lisa",
    type: "intent",
    state: "working",
    reason: "interest_match",
    activity: { kind: "food", title: "Shawarma Point" },
    note: "Free Tuesday after my Northwind interview, want to go?",
    at: new Date(now).toISOString(),
  };
}

async function send(deliver: Deliver, url: string, token: string, message: unknown): Promise<{ status: number; error: string }> {
  try {
    const response = await deliver(url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ message, stamp: { passed: [], removed: [], windowsDropped: 0 }, redaction: null }),
    });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    return { status: response.status, error: body.error ?? response.statusText };
  } catch (error) {
    return { status: 0, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Sends the forgeries and reports what the inbox answered. `deliver` is `fetch` in the route; a test passes the
 * inbox route handler instead.
 */
export async function tryToLeak(origin: string, deliver: Deliver = fetch): Promise<LeakAttempt[]> {
  const url = `${origin}/api/agents/lisa/inbox`;
  const message = forgedMessage();
  const wrong = await send(deliver, url, "forged-token", message);
  const priv = await send(deliver, url, agentToken("aaron"), message);
  return [
    { id: "wrong_bearer", label: "A message with a made-up bearer token", ...wrong, rejected: wrong.status >= 400 },
    { id: "private_note", label: "A real sender's token, with a private calendar event in the note", ...priv, rejected: priv.status >= 400 },
  ];
}
