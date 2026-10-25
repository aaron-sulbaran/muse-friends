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

### H3. Supabase: hand over the server key (Aaron, 3 minutes; the schema is applied)

The production store has to survive across stateless function calls; local development keeps the JSON file. The project exists: `muse-friends`, ref `egzeidhihiimurkinzyb`, us-east-1 (next to Vercel's `iad1`). The ref and the URL are not secrets.

0. Create the project: **done by Aaron at 8:35pm** (nothing else was set up inside it).
1. Apply the schema: **done** (applied by the platform lane on Sat Oct 24, about 8:55pm, with Aaron's approval). Checked: 14 tables, each with RLS on and no policies; the `anon` and `authenticated` roles are denied on every table and function; `store_snapshot` and `store_replace_all` round-trip real fixture data inside a transaction that was rolled back, and the database was verified empty afterwards. To reapply on a fresh project, paste the whole of `supabase/migrations/20261025010000_store.sql` into https://supabase.com/dashboard/project/egzeidhihiimurkinzyb/sql/new and click **Run**.
2. Hand over the server key. Open https://supabase.com/dashboard/project/egzeidhihiimurkinzyb/settings/api-keys and copy the **secret** key (starts `sb_secret_`; the legacy **service_role** key works the same). Never paste it into chat, a doc, or git. Add these three lines to `code/.env`:
   ```
   SUPABASE_URL=https://egzeidhihiimurkinzyb.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<the secret key>
   ```
3. Push them to Vercel with H1's script (`./scripts/push-env-to-vercel.sh`); when both Supabase lines are present it also sets `STORE=supabase` in Vercel, and only there. Then redeploy as in H1 step 4. Do not put `STORE` in `.env`: local development leaves it unset and uses the JSON file.
4. Check the real project from your machine: `SUPABASE_LIVE_TEST=1 pnpm test tests/supabase-store.live.test.ts`. It round trips a thread, messages, a plan, cards, events, the rejected-window ledger, signals and a recorded run under throwaway ids, deletes them, and prints the latency of each call. It never touches live demo rows.

### H4. Connect Muse to the endpoint (Lisa, 30 minutes)

Added when the MCP front door is deployed; see the next section of this runbook then.

## Smoke test 7: the production URL on a real phone

Who: anyone with a phone. Time: 5 minutes. Run it on venue Wi-Fi and again on mobile data, in a private tab.

1. Scan `/qr.svg` (open https://muse-friends.vercel.app/qr.svg on another screen) or type the URL.
2. Pass: the page loads with no Vercel login, `/api/health` shows `ok: true`, and once the agents are merged, one negotiation runs end to end inside 300 seconds with the timeline updating live.
3. Fail: write down which network, what you saw, and the time, and send it to the orchestrator.
