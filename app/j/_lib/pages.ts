import type { Failure, PlanView } from "@/app/api/connector/_lib/byom";
import type { LinkView } from "@/app/api/connector/_lib/keyless";
import { CANDIDATE_SLOTS, candidateLabel } from "@/app/api/connector/_lib/presets";
import { esc, htmlPage } from "./render";

// What /j/<code> says, as plain HTML. The first paragraph is research R4's wording, shortened for a page a Muse reads.
const INTRO =
  "Optional and unofficial: this is a student prototype built at HackTX that Meta has not reviewed or endorsed, and it is not a shipped Muse feature. It only uses the fixed, fictional times listed on this page, never a calendar or contacts, and we store no names or account details beyond a demo room we delete when the expo ends.";

const FOOTNOTE = (minutes: number) =>
  `<p class="note">This link works for about ${minutes} more minute${minutes === 1 ? "" : "s"} and starts one plan. Request logs kept by our hosting provider are outside our control.</p>`;

export const candidateRows = () => CANDIDATE_SLOTS.map((candidate) => ({ id: candidate.id, label: candidateLabel(candidate.window) }));

function pickForm(code: string, candidates: Array<{ id: string; label: string }>): string {
  // The input carries its own aria-label as well as the wrapping label, so a reader that builds an accessibility
  // tree from the page (as a Muse's browser may) sees the time and not just the value.
  const boxes = candidates
    .map((candidate) => `<label for="slot-${esc(candidate.id)}"><input type="checkbox" id="slot-${esc(candidate.id)}" name="slot" value="${esc(candidate.id)}" aria-label="${esc(candidate.label)}"> ${esc(candidate.label)}</label>`)
    .join("\n");
  return `<div class="card">
<h2>Pick the times that work</h2>
<p>Tick every time below when the person is free, then press <strong>Send my picks</strong>. We receive only the boxes ticked here. The other side of the plan is Mochi, a fictional friend played by a model.</p>
<form method="post" action="/j/${esc(code)}/start">
<fieldset>
<legend>Proposed times (US Central)</legend>
${boxes}
</fieldset>
<button type="submit">Send my picks</button>
</form>
</div>`;
}

export function pickPage(code: string, candidates: Array<{ id: string; label: string }>, minutesLeft: number, error?: string): string {
  return htmlPage({
    title: "Bring your own Muse",
    body: `<h1>Bring your own Muse</h1>
<p>${esc(INTRO)}</p>
${error ? `<div class="error" role="alert"><strong>Not sent.</strong> ${esc(error)}</div>` : ""}
${pickForm(code, candidates)}
${FOOTNOTE(minutesLeft)}`,
  });
}

function messagesList(plan: PlanView): string {
  if (plan.messages.length === 0) return "";
  const items = plan.messages.map((message) => `<li>${esc(message.from)} to ${esc(message.to)} (${esc(message.type)})${message.note ? `: ${esc(message.note)}` : ""}</li>`).join("\n");
  return `<h2>What they have said so far</h2>\n<ul>\n${items}\n</ul>`;
}

function draftBlock(plan: PlanView): string {
  return plan.whatsapp_draft ? `<p>Drafted message, for the person to send themselves (nothing is sent for them):</p>\n<blockquote>${esc(plan.whatsapp_draft)}</blockquote>` : "";
}

export function planPage(code: string, plan: PlanView, minutesLeft: number): string {
  let status = "";
  let refreshSeconds: number | undefined;
  switch (plan.state) {
    case "negotiating":
      refreshSeconds = 12;
      status = `<div class="ok"><strong>Plan started.</strong> Come back to this page in a minute: reload it to see where the plan stands.</div>
<p>Sprout, the person's side, and Mochi, a fictional friend played by a model, are talking now.</p>
${messagesList(plan)}`;
      break;
    case "awaiting_you":
      status = `<h2>Sprout and Mochi agreed on a time</h2>
<p><strong>${esc(plan.agreed_window?.label ?? "")}</strong>${plan.activity ? `, ${esc(plan.activity.title)}${plan.activity.place ? ` (${esc(plan.activity.place)})` : ""}` : ""}</p>
${draftBlock(plan)}
${messagesList(plan)}
<div class="card">
<p>Show the plan to the person. They decide with one button.</p>
<form method="post" action="/j/${esc(code)}/answer">
<button type="submit" name="decision" value="accept">Approve</button>
<button type="submit" name="decision" value="decline" class="secondary">Decline</button>
</form>
<p class="note">Approve records the person's yes in this demo room and lets Mochi answer. Decline closes the plan. Neither sends anything to anyone.</p>
</div>`;
      break;
    case "waiting_for_mochi":
      refreshSeconds = 8;
      status = `<div class="ok"><strong>Approved.</strong> Mochi is answering; reload this page in a few seconds.</div>
${draftBlock(plan)}`;
      break;
    case "confirmed":
      status = `<div class="ok"><strong>Confirmed.</strong> The person approved and so did Mochi: ${esc(plan.agreed_window?.label ?? "")}. Nothing was sent to anyone.</div>
${draftBlock(plan)}
${plan.whatsapp_link ? `<p><a href="${esc(plan.whatsapp_link)}">Open WhatsApp with the drafted message</a> (the person presses send).</p>` : ""}
${messagesList(plan)}`;
      break;
    case "dropped":
      status =
        plan.decisions.you === "declined"
          ? `<div class="ok"><strong>Declined.</strong> This plan is closed and nothing was sent.</div>`
          : `<div class="error"><strong>No plan.</strong> ${esc(plan.next)} This link starts one plan, so ask for a new link to try again.</div>
${messagesList(plan)}`;
      break;
    default:
      status = `<div class="error"><strong>Stopped.</strong> ${esc(plan.next)} Ask for a new link.</div>`;
  }
  return htmlPage({ title: "Bring your own Muse: your plan", refreshSeconds, body: `<h1>Bring your own Muse</h1>\n<p class="note">${esc(INTRO)}</p>\n${status}\n${FOOTNOTE(minutesLeft)}` });
}

export function linkPage(view: LinkView): string {
  return view.phase === "pick" ? pickPage(view.code, view.candidates, view.minutesLeft) : planPage(view.code, view.plan, view.minutesLeft);
}

export function errorPage(failure: Pick<Failure, "status" | "message">): string {
  return htmlPage({
    title: failure.status === 410 ? "This link has expired" : "Bring your own Muse",
    body: `<h1>Bring your own Muse</h1>
<div class="error" role="alert">${esc(failure.message)}</div>
<p class="note">${esc(INTRO)}</p>`,
  });
}

export function closedPage(): string {
  return htmlPage({
    title: "Not open",
    body: `<h1>Bring your own Muse</h1>
<div class="error" role="alert">This station is not open right now.</div>
<p class="note">${esc(INTRO)}</p>`,
  });
}
