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

Production needs `MODEL_API_KEY` for the agents (and, later, the Supabase variables, see H3). One script copies what is set in `code/.env` to the Vercel project for Production and Preview, stored as Sensitive, and never prints a value. Do this before the P1 checkpoint (Sun 12:00am).

1. In a terminal, from the `code` folder (the checkout that holds your real `.env`): `./scripts/push-env-to-vercel.sh --dry-run`. Expect names with character counts and `dry run only; nothing was changed.`
2. Run `./scripts/push-env-to-vercel.sh`. Expect `pushed MODEL_API_KEY (49 characters, secret)`. If the Vercel CLI asks which Git branch a Preview variable is for, press Enter (all branches).
3. Check: `vercel env ls` lists `MODEL_API_KEY` for Production and Preview.
4. Redeploy so the running deployment picks it up: open https://vercel.com/aaron-sulbaran-projects/muse-friends, **Deployments**, the latest production deployment, **...**, **Redeploy**, confirm. Expect Ready in about 30 seconds. (Any merge to `main` also redeploys.)

Dashboard fallback if the script fails: https://vercel.com/aaron-sulbaran-projects/muse-friends/settings/environment-variables, **Add Environment Variable**, key `MODEL_API_KEY`, value from `.env` (the text after the `=`, no quotes), Environments **Production** and **Preview**, **Sensitive** on, **Save**; then redeploy as in step 4. Re-run the script (or repeat the dashboard steps) whenever a new variable is added to `.env`.

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

### H4. Connect Muse to the endpoint (Lisa, 30 minutes)

Added when the MCP front door is deployed; see the next section of this runbook then.

## Smoke test 7: the production URL on a real phone

Who: anyone with a phone. Time: 5 minutes. Run it on venue Wi-Fi and again on mobile data, in a private tab.

0. Optional first pass from a laptop on the same network: `./scripts/smoke-production.sh`. Expect seven `PASS` lines (health, home, both phones, the QR file, the stylesheet, the state JSON), none over 3 seconds, none redirected to a Vercel login. It does not run the negotiation; that is step 2 on a phone.
1. Scan `/qr.svg` (open https://muse-friends.vercel.app/qr.svg on another screen) or type the URL.
2. Pass: the page loads with no Vercel login, `/api/health` shows `ok: true`, and once the agents are merged, one negotiation runs end to end inside 300 seconds with the timeline updating live.
3. Fail: write down which network, what you saw, and the time, and send it to the orchestrator.

## If production shows old styles after a deploy

Symptom: the stage renders black and unstyled (system font, dark mode), yet `/api/health` shows the new commit.

What happened (Sat Oct 24, about 8:45pm): production builds restore the previous production build cache. Twice in a row the Turbopack output for `app/globals.css` (processed by the Tailwind loader) stayed the old scaffold stylesheet while the HTML and JavaScript were new. Preview builds, whose cache came from a different lineage, produced the right stylesheet from the same source, and a clean local build did too.

Check, from anywhere:

```bash
curl -s https://muse-friends.vercel.app/ | grep -o '/_next/static/[^"]*\.css'
curl -s https://muse-friends.vercel.app/<the path printed above> | grep -c -- '--color-screen'
```

Expect a count of 1 or more. `./scripts/smoke-production.sh` runs the same check ("stylesheet carries the brand tokens").

Fix: `vercel.json` now builds with `rm -rf .next && pnpm run build`, so no restored cache can reach the compiler and every deploy is a clean build (it adds a few seconds). If it ever happens anyway, open the Vercel project, **Deployments**, the latest production deployment, **...**, **Redeploy**, untick **Use existing Build Cache**, **Redeploy**, then rerun the check. Also confirm you opened `https://muse-friends.vercel.app` and not a preview or a team-scoped alias, which sit behind a login and can lag.

