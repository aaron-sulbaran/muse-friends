# Runbook: platform and deploy

How Muse Friends is hosted, and every step that needs a human with a dashboard login. Each human step has a number (H1, H2, ...), who does it, how long it takes, the exact clicks, and what you should see. Steps are listed in the order they unblock the build.

## Where things live

| Thing | Value |
|---|---|
| Production URL (QR code, judges, README) | https://muse-friends.vercel.app |
| Health check | https://muse-friends.vercel.app/api/health returns `{"ok":true,"sha":"<7 chars>"}`; `sha` is the deployed commit |
| Vercel project | `muse-friends`, team "Aaron's Personal Projects" (Hobby), region `iad1` |
| Git connection | `aaron-sulbaran/muse-friends`; `main` deploys to production, every other branch to a preview |
| QR code | `public/qr.svg` (served at `/qr.svg`), encodes the production URL |

## How deploys work

- Push to `main`: production deploy, served on `muse-friends.vercel.app` within about a minute.
- Push to any other branch: a preview deploy with its own URL. **Previews are behind Vercel Authentication** (a Vercel login is required to open them). Only the primary production alias `muse-friends.vercel.app` is public; the team-scoped alias `muse-friends-aaron-sulbaran-projects.vercel.app` also redirects to a Vercel login. Always hand out and test the short URL.
- This is a Hobby project, and Hobby limits Git deploys to the account owner's own commits (not yet tested here with a second author). If a push from someone else never produces a deployment, deploy from the owner's machine with `vercel --prod`.
- Environment variables apply to new deployments only. After adding or changing one, redeploy (H1 step 4).

CLI, from the repo root of a linked checkout (`vercel link --yes --project muse-friends --scope aaron-sulbaran-projects` once per checkout; the link folder `.vercel/` is gitignored):

```bash
vercel ls muse-friends          # recent deployments and their state
vercel logs <deployment-url>    # runtime logs of one deployment
vercel inspect <deployment-url> # build details
```

## Regenerating the QR code

Run this whenever the production URL changes (for example when `musefriends.tech` goes live), then commit `public/qr.svg`:

```bash
pnpm dlx qrcode@1.5.4 -t svg -e M -q 2 -o public/qr.svg "https://muse-friends.vercel.app"
```

Check it by pointing a phone camera at the file opened on screen; it must open the URL in a private window with no login.

## Human steps

### H1. Push the secrets into Vercel (Aaron, 3 minutes)

Production needs `MODEL_API_KEY` (the agents) and the two MCP tokens (the connector front door). One script copies them from `code/.env` to the Vercel project for Production and Preview, stored as Sensitive, and never prints a value. It generates `MCP_TOKEN_A` and `MCP_TOKEN_B` into `.env` first if they are missing.

1. In a terminal, from the `code` folder (the checkout that holds your real `.env`): `./scripts/push-env-to-vercel.sh --dry-run`. Expect a list of names with character counts and `dry run only; nothing was changed.`
2. Run `./scripts/push-env-to-vercel.sh`. Expect `pushed MODEL_API_KEY`, `pushed MCP_TOKEN_A`, `pushed MCP_TOKEN_B`. If the Vercel CLI asks which Git branch a Preview variable is for, press Enter (all branches).
3. Check: `vercel env ls` lists the three names for Production and Preview.
4. Redeploy so the running deployment picks them up: open https://vercel.com/aaron-sulbaran-projects/muse-friends, **Deployments**, the latest production deployment, **...**, **Redeploy**, confirm. Expect Ready in about 30 seconds. (Any merge to `main` also redeploys.)
5. Check the front door: `./scripts/mcp-smoke.sh`. Expect four `PASS` lines and `all checks passed.`

Dashboard fallback if the script fails: https://vercel.com/aaron-sulbaran-projects/muse-friends/settings/environment-variables, **Add Environment Variable**, one per name, value from `.env` (the text after the `=`, no quotes), Environments **Production** and **Preview**, **Sensitive** on, **Save**; then redeploy as in step 4.

### H2. Connect musefriends.tech (Aaron, 10 minutes, after claiming the domain)

1. Open https://vercel.com/aaron-sulbaran-projects/muse-friends/settings/domains, click **Add Domain**, type `musefriends.tech`, and choose the option that redirects `www` to the apex.
2. Vercel shows the DNS records it wants. Expect an **A** record on `@` (usually `76.76.21.21`) and a **CNAME** on `www`; the values on your screen win over these. Send them to the orchestrator so this page can record them.
3. In the get.tech account for the domain, open **DNS management**, delete any parking A record on `@`, add the two records, save.
4. Wait up to 30 minutes. On the Vercel Domains page the domain changes from "Invalid Configuration" to a check mark and a certificate is issued on its own.
5. In a private window on a phone, `https://musefriends.tech` must load the app with a lock icon and `https://www.musefriends.tech` must redirect to it.
6. Tell the orchestrator. The platform lane then regenerates the QR code for the new URL (section above) and the README links change.

DNS records Vercel showed for this project: _not added yet; filled in after step 2._

### H3. Supabase project for the production store (Aaron, 5 minutes)

Needed for the production store, which has to survive across stateless function calls. Local development keeps using the JSON file.

1. Open https://supabase.com/dashboard, **New project**. Name: `muse-friends`. Region: the closest to Austin (US East or US Central, whichever the list offers). Plan: Free. Set a database password and store it in your password manager; nobody else needs it. Click **Create new project**; it takes about two minutes.
2. Send the **project ref** (the part of the dashboard URL after `/project/`) to the orchestrator. The ref is not a secret.
3. Open **Project Settings**, **API Keys**. Copy the **service role** key. Do not put it in chat or in git. Paste it as `SUPABASE_SERVICE_ROLE_KEY` in Vercel (same screen and steps as H1, Production and Preview, **Sensitive** on) and in `code/.env`. Also add `SUPABASE_URL` (Project Settings, **Data API**, the project URL) the same way; that one is not sensitive.
4. Expect the platform lane to apply the schema through the Supabase tooling once it has the ref, then report round trip latency.

### H4. Try the real Muse connection (Lisa, 30 minutes, after H1)

This is the go or no-go test for the connector segment. It is gated and optional: the web sandbox is the product either way, and if this fails the demo carries a slide instead. The server side is a bearer-protected MCP endpoint with one read-only tool, `get_status`, at https://muse-friends.vercel.app/api/mcp.

Before you start: Aaron has finished H1 and sends you the value of `MCP_TOKEN_A` from his `.env` through the password manager or a direct message (never git, never a shared doc). Use only your own Muse account, and use this key and no other.

1. In your Muse app, in chat, ask Muse to create a custom connector for a remote MCP server at `https://muse-friends.vercel.app/api/mcp` that uses an API key. The exact wording may differ; Muse's own reply decides the next click. Expect a hosted connect link.
2. Open the link and enter the key (`MCP_TOKEN_A`). Expect Muse to say it connected and to list a tool called `get_status`.
3. Ask Muse: "Use the Muse Friends connector to call get_status." Expect an approval prompt (read-only, ask each time, or allow); approve it once.
4. Pass: Muse reports `ok: true`, `service: muse-friends`, and `account: a`.
5. Report back to the orchestrator, for each of steps 1 to 4: worked or did not, the exact error text if any, and whether your account type (free or paid) blocked a step. No account details, no screenshots of settings that show them.

If it fails, do not retry with other keys. The server logs one line per request (`mcp auth scheme=... accepted=...`, never the key), so the platform lane can tell whether Muse reached the endpoint, which header it sent the key in, and whether the key matched; tell the orchestrator the time of your last attempt. If Muse insists on OAuth and offers no API key field, report that; the connector segment is then off.

Behind the endpoint: both `MCP_TOKEN_A` and `MCP_TOKEN_B` work and map to roles A and B. The key may arrive as `Authorization: Bearer <key>` or `X-API-Key: <key>`. An unset or short token never matches, so the endpoint stays closed until H1 is done. `start_plan`, `check_inbox`, and `respond` are added only if this test passes and the humans pick the connector segment.

## Smoke test 7: the production URL on a real phone

Who: anyone with a phone. Time: 5 minutes. Run it on venue Wi-Fi and again on mobile data, in a private tab.

1. Scan `/qr.svg` (open https://muse-friends.vercel.app/qr.svg on another screen) or type the URL.
2. Pass: the page loads with no Vercel login, `/api/health` shows `ok: true`, and once the agents are merged, one negotiation runs end to end inside 300 seconds with the timeline updating live.
3. Fail: write down which network, what you saw, and the time, and send it to the orchestrator.
