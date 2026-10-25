import type { Metadata } from "next";
import { headers } from "next/headers";
import { describePresets } from "@/app/api/connector/_lib/presets";
import { CopyButton } from "./CopyButton";

// An opt-in table station: a person connects their own Muse to a room of its own on this server. The key
// is read from the environment on every request, never from the repo, and with it unset the page says
// the station is closed. The page is also the docs page the REST variant of the connect message points Muse at.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Bring your own Muse",
  description: "Optional and unofficial: connect your own Muse to a student prototype that uses fixed, fictional time slots.",
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

type ToolDoc = {
  name: string;
  rest: string;
  kind: "Read" | "Write";
  input: string;
  returns: string;
  sideEffects: string;
  errors: string;
  limits: string;
};

// What Muse can read here as a docs page: for each tool, the inputs, the outputs, whether it is a Read or a
// Write, what it changes, how it can fail, and its limits.
const tools: ToolDoc[] = [
  {
    name: "get_status",
    rest: "GET /api/connector/status",
    kind: "Read",
    input: "none",
    returns: "{ ok, service, deploy, account, store, at }: whether the service and its store answer, the account label of the key you used, and counts of stored threads, messages, plans, cards and activity rows. Never their content.",
    sideEffects: "None. It changes nothing.",
    errors: "401 when the key is missing or wrong.",
    limits: "None of its own.",
  },
  {
    name: "start_plan",
    rest: "POST /api/connector/start_plan",
    kind: "Write",
    input: 'slots: "evenings", "lunches" or "weekend". That is the only input. Free text and windows of your own are refused (400).',
    returns: "202 { planId, contextId, state: \"negotiating\", you: \"Sprout\", friend, slots, free_windows, expires_in_minutes: 120, how_to_check }.",
    sideEffects: "Creates one plan room, a fictional copy of the demo (never the real demo room), and starts Sprout and Mochi talking. It spends a few model calls on our side. The room is no longer served after 2 hours and is deleted when the expo ends.",
    errors: "400 bad_input, 401, 403 (a key that is not the judge key), 422 slots_expired, 429 room_cap or runs_paused (with Retry-After), 503 rooms_unavailable.",
    limits: "10 new plans an hour across everyone; the app-wide hourly limit on model calls can also pause it.",
  },
  {
    name: "check_plan",
    rest: "GET /api/connector/check_plan?planId=...",
    kind: "Write",
    input: "planId (from start_plan)",
    returns: "{ planId, state: negotiating | awaiting_you | waiting_for_mochi | confirmed | dropped | stalled, messages so far with what the sharing policy let through or withheld, agreed_window, decisions, whatsapp_draft, whatsapp_link, next }.",
    sideEffects: "Inside that plan's room only. When the person has already said yes and the fictional friend has not answered yet, this call lets her answer (one model call) and saves it. Nothing is sent to anyone.",
    errors: "400 bad_input, 401, 403, 404 no_such_plan (unknown or expired), 503.",
    limits: "None of its own. About every 10 seconds is plenty.",
  },
  {
    name: "respond",
    rest: "POST /api/connector/respond",
    kind: "Write",
    input: 'planId, decision: "accept" or "decline"',
    returns: "The plan as check_plan shows it, plus you_answered.",
    sideEffects: "Records the person's own decision in that plan's room. After an accept the fictional friend answers. Nothing is sent to anyone: the drafted message is for the person to send themselves, and no calendar entry is made.",
    errors: "400 bad_input, 401, 403, 404 no_such_plan, 409 not_waiting_for_you (the agents have not agreed yet, or it is already answered), 503.",
    limits: "None of its own.",
  },
];

export default async function ConnectPage() {
  const key = process.env.MCP_TOKEN_JUDGE;
  const open = Boolean(key) && (key as string).length >= MIN_KEY_LENGTH;
  const origin = await originOf();
  const presets = describePresets();

  const mcpMessage = `Connect my Muse Friends tool: remote MCP server, streamable HTTP, ${origin}/api/mcp . Auth is an Authorization: Bearer header; ask for the token in your secure credential prompt. Test get_status, then save it as a skill.`;
  const restMessage = `Connect Muse Friends. Base URL ${origin} , every request needs an Authorization: Bearer header; ask me for the token in your secure credential prompt. Read ${origin}/connect , then test GET /api/connector/status.`;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-4 py-8 text-ink">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Bring your own Muse</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">
          Optional and unofficial: this connects your own Muse to a student prototype built at HackTX that Meta has not reviewed or endorsed, and it is not a shipped Muse feature. It only exchanges fixed, fictional time slots that we supply, never your calendar or contacts, and we store no names or account details beyond a demo room we delete when the expo ends.
        </p>
      </header>

      <Card title="Before you connect">
        <p>
          <strong>What we receive:</strong> the label of the key you connect with (it says &ldquo;judge&rdquo; and nothing about you), the name of one preset (evenings, lunches or weekend), a plan id, and your yes or no. No calendar, contacts, messages or location are read, and nothing you type is accepted: the only inputs are those listed below.
        </p>
        <p>
          <strong>What we keep:</strong> each plan is a room of its own, made of fictional times, a fictional friend (Mochi, played by a model) and a made-up reel. A room is no longer served after 2 hours, and we delete all of them when the expo ends. Everything in it is fictional.
        </p>
        <p>
          <strong>What we cannot promise:</strong> Muse calls us from Meta&apos;s cloud, and our hosting provider keeps ordinary request logs that we do not control. The connector&apos;s own log lines say only whether a key was accepted, never the key. This is a private custom connector, not a listed one. Meta&apos;s own help asks people to grant access with caution and to review a provider&apos;s privacy policies; please do, and connect only if this is fine with you.
        </p>
        <p>
          <strong>Taking it back:</strong> in Muse, open Settings, then Connectors, and remove Muse Friends. The key is a shared demo key for this table only.
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
              <li>Muse asks before it acts, in its own prompts (for example allow once, for this task, always, or deny). Those prompts are Muse&apos;s, not ours; choosing &ldquo;Allow once&rdquo; each time is fine.</li>
              <li>
                Then ask, in your own words: <em>&ldquo;Use Muse Friends to start a plan for evenings, check on it until Sprout and Mochi agree, show me the plan and the drafted message, and only answer after I say yes.&rdquo;</em>
              </li>
            </ol>
            <p className="text-sm text-muted">
              We do not rely on, or promise, anything your Muse does on a schedule or on its own: each step happens when you ask for it in the chat. The wording of the two messages is a best guess from how Muse is documented to connect; nobody has confirmed it end to end yet. If Muse asks something else, answer it plainly, and tell the person at the table what it said.
            </p>
          </Card>

          <Card title="The time slots">
            <p className="text-sm text-muted">These are the only choices for start_plan. They are made up, US Central, and the same for everyone. Sprout is your side; Mochi is the fictional friend. Each preset has at least an hour both are free.</p>
            <div className="space-y-3">
              {presets.map((preset) => (
                <div key={preset.name} className="rounded-group bg-group p-4 text-[14px] leading-relaxed">
                  <div className="font-mono text-[13px] font-semibold">slots: &quot;{preset.name}&quot;</div>
                  <div className="text-muted">{preset.description}</div>
                  <dl className="mt-2 space-y-1">
                    <div><dt className="inline font-semibold">Sprout is free: </dt><dd className="inline">{preset.sprout.join("; ")}</dd></div>
                    <div><dt className="inline font-semibold">Mochi is free: </dt><dd className="inline">{preset.mochi.join("; ")}</dd></div>
                  </dl>
                </div>
              ))}
            </div>
          </Card>

          <Card title="What your Muse can call">
            <p className="text-sm text-muted">
              Four tools, the same over MCP ({origin}/api/mcp) and as plain web calls under {origin}/api/connector/. Every request needs an Authorization header with the key, as &ldquo;Bearer &lt;key&gt;&rdquo;. Replies are JSON; the web calls wrap them as {"{ data, error }"}. Read means it changes nothing; Write means it changes something, here only inside a plan&apos;s own fictional room.
            </p>
            <div className="space-y-3">
              {tools.map((tool) => (
                <div key={tool.name} className="rounded-group bg-group p-4 text-[14px] leading-relaxed">
                  <div className="font-mono text-[13px] font-semibold">{tool.name}</div>
                  <div className="break-words font-mono text-[12px] text-muted">{tool.rest}</div>
                  <dl className="mt-2 space-y-1">
                    <div><dt className="inline font-semibold">Class: </dt><dd className="inline">{tool.kind}</dd></div>
                    <div><dt className="inline font-semibold">Input: </dt><dd className="inline">{tool.input}</dd></div>
                    <div><dt className="inline font-semibold">Returns: </dt><dd className="inline">{tool.returns}</dd></div>
                    <div><dt className="inline font-semibold">Side effects: </dt><dd className="inline">{tool.sideEffects}</dd></div>
                    <div><dt className="inline font-semibold">Errors: </dt><dd className="inline">{tool.errors}</dd></div>
                    <div><dt className="inline font-semibold">Limits: </dt><dd className="inline">{tool.limits}</dd></div>
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
