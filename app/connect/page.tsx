import type { Metadata } from "next";
import { headers } from "next/headers";
import { CopyButton } from "./CopyButton";

// An opt-in table station: a person connects their own Muse to a room of its own on this server. The key
// is read from the environment on every request, never from the repo, and with it unset the page says
// the station is closed. The page is also the docs page the REST variant of the connect message points Muse at.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Bring your own Muse",
  description: "An optional, unofficial way to try Muse Friends from your own Muse.",
  robots: { index: false, follow: false },
};

const MIN_KEY_LENGTH = 24;

async function originOf(): Promise<string> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "www.musefriends.tech";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${protocol}://${host}`;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card bg-surface p-6 shadow-float">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3 space-y-3 text-[15px] leading-relaxed">{children}</div>
    </section>
  );
}

function Message({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-group bg-group p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{label}</div>
      <div className="flex flex-col items-start gap-3 sm:flex-row">
        <p className="min-w-0 flex-1 break-words font-mono text-[13px] leading-relaxed">{text}</p>
        <CopyButton text={text} />
      </div>
    </div>
  );
}

const tools: Array<{ name: string; rest: string; kind: string; input: string; output: string }> = [
  { name: "get_status", rest: "GET /api/connector/status", kind: "Read", input: "none", output: "{ ok, service, deploy, account, store: counts, at }. Changes nothing." },
  {
    name: "start_plan",
    rest: "POST /api/connector/start_plan",
    kind: "Write (starts a plan in a room of its own)",
    input: 'free_windows: 1 to 3 of { day: "2026-10-29", start: "19:00", end: "21:00" } (whole hours, 09:00 to 22:00 US Central, inside the next 7 days and Oct 25 to Oct 31); reel_hint (optional): one line, at most 140 characters',
    output: "202 { planId, contextId, state, how_to_check, expires_in_minutes }",
  },
  {
    name: "check_plan",
    rest: "GET /api/connector/check_plan?planId=...",
    kind: "Read",
    input: "planId",
    output: "{ state: negotiating | awaiting_you | waiting_for_mochi | confirmed | dropped | stalled, messages so far with what the sharing policy let through or withheld, agreed_window, whatsapp_draft, next }",
  },
  {
    name: "respond",
    rest: "POST /api/connector/respond",
    kind: "Write (records your own decision in that room)",
    input: 'planId, decision: "accept" or "decline"',
    output: "the plan as check_plan shows it, plus you_answered. Nothing is sent to anyone: the drafted message is yours to send.",
  },
];

export default async function ConnectPage() {
  const key = process.env.MCP_TOKEN_JUDGE;
  const open = Boolean(key) && (key as string).length >= MIN_KEY_LENGTH;
  const hintAllowed = process.env.BYOM_ALLOW_HINT !== "0";
  const origin = await originOf();

  const mcpMessage = `Connect my Muse Friends tool: remote MCP server, streamable HTTP, ${origin}/api/mcp . Auth is an Authorization: Bearer header; ask for the token in your secure credential prompt. Test get_status, then save it as a skill.`;
  const restMessage = `Connect Muse Friends. Base URL ${origin} , every request needs an Authorization: Bearer header; ask me for the token in your secure credential prompt. Read ${origin}/connect , then test GET /api/connector/status.`;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 text-ink">
      <header>
        <p className="text-sm font-semibold text-accent">Optional and unofficial</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Bring your own Muse</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Connect your own Muse to a student prototype from HackTX, and let it plan a dinner with a fictional friend while you watch. It takes about 1 to 4 minutes.
        </p>
      </header>

      <Card title="What this is, and what it is not">
        <p>
          Muse Friends is a proposal for Muse, built at HackTX 2026. It is not a shipped Muse feature, Meta has not reviewed or endorsed it, and this connector is a private custom connector that Meta does not review. Connect only if you are comfortable with that.
        </p>
        <p>
          <strong>What we receive:</strong> only the free time windows your Muse sends (made-up times are fine){hintAllowed ? ", an optional one-line hint about what you would like to do," : ""} and a plan id. We never read your calendar, contacts, messages, or location, and we ask for no name or account details. Muse calls us from Meta&apos;s cloud, so our host&apos;s ordinary request logs exist.
        </p>
        <p>
          <strong>What we keep:</strong> each plan lives in a room of its own for 2 hours and is then no longer served; we delete the rooms after the event. The friend, Mochi, is fictional and played by a model. You can disconnect any time in Muse under Settings, then Connectors.
        </p>
      </Card>

      {open ? (
        <>
          <Card title="Connect">
            <ol className="list-decimal space-y-3 pl-5">
              <li>Open Muse (the app or muse.ai) and start a new chat.</li>
              <li>
                Paste one of these messages. The first works if Muse takes MCP servers; use the second if it only takes a web API.
                <div className="mt-3 space-y-3">
                  <Message label="MCP" text={mcpMessage} />
                  <Message label="Web API" text={restMessage} />
                </div>
              </li>
              <li>
                When Muse asks for the key in its secure prompt, paste this one.
                <div className="mt-3 flex items-center gap-3 rounded-group bg-group p-4">
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-muted" aria-label="The key, hidden">
                    ••••••••••••••••••••
                  </span>
                  <CopyButton text={key as string} label="Copy key" />
                </div>
              </li>
              <li>Approve what Muse asks to do. Choosing &ldquo;Allow once&rdquo; each time is fine.</li>
              <li>
                Then ask, in your own words: <em>&ldquo;Use Muse Friends to start a plan with Mochi where I&apos;m free one evening this week from 7 to 9pm, check on it until Sprout and Mochi agree, show me the plan and the drafted message, and only answer after I say yes.&rdquo;</em>
              </li>
            </ol>
            <p className="text-sm text-muted">
              The wording of the two messages is a best guess from how Muse is documented to connect; nobody has confirmed it end to end yet. If Muse asks something else, answer it plainly, and tell the person at the table what it said.
            </p>
          </Card>

          <Card title="What your Muse can call">
            <p className="text-sm text-muted">Read means it changes nothing. Plans are limited to 10 new ones an hour across everyone, and a plan expires after 2 hours. Errors come back as plain messages (a bad window, no time Mochi could also do, a plan that has expired).</p>
            <div className="space-y-3">
              {tools.map((tool) => (
                <div key={tool.name} className="rounded-group bg-group p-4 text-[14px] leading-relaxed">
                  <div className="font-mono text-[13px] font-semibold">{tool.name}</div>
                  <div className="font-mono text-[12px] text-muted">{tool.rest}</div>
                  <dl className="mt-2 space-y-1">
                    <div><dt className="inline font-semibold">Kind: </dt><dd className="inline">{tool.kind}</dd></div>
                    <div><dt className="inline font-semibold">Input: </dt><dd className="inline">{tool.input}</dd></div>
                    <div><dt className="inline font-semibold">Returns: </dt><dd className="inline">{tool.output}</dd></div>
                  </dl>
                </div>
              ))}
            </div>
          </Card>
        </>
      ) : (
        <Card title="Closed right now">
          <p>This station is not open at the moment, so there is nothing to connect to. If you are at the table, ask someone from the team to open it.</p>
        </Card>
      )}

      <div className="flex items-center gap-4 rounded-card bg-surface p-5 shadow-float">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/connect-qr.svg" alt="QR code for this page" width={120} height={120} className="shrink-0" />
        <p className="text-sm leading-relaxed text-muted">Scan to open this page on your phone. The live demo, with two phones and no setup, is at the front of the table.</p>
      </div>
    </main>
  );
}
