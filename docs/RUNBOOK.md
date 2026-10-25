# Runbook: platform and deploy

How Muse Friends is hosted, and every step that needs a human with a dashboard login. Each human step has a number (H1, H2, ...), who does it, how long it takes, the exact clicks, and what you should see. Steps are listed in the order they unblock the build.

## Where things live

| Thing | Value |
|---|---|
| Production URL (QR code, judges, README) | https://musefriends.tech. The canonical address is **https://www.musefriends.tech**: the bare name answers with a 308 redirect to it, so the browser's address bar ends on `www` |
| Fallback address | https://muse-friends.vercel.app: public and always live; hand this one out if the domain ever misbehaves |
| Health check | https://musefriends.tech/api/health (after the redirect, https://www.musefriends.tech/api/health) returns `{"ok":true,"sha":"<7 chars>"}`; `sha` is the deployed commit |
| Vercel project | `muse-friends`, team "Aaron's Personal Projects" (Hobby), region `iad1` |
| Git connection | `aaron-sulbaran/muse-friends`; `main` deploys to production, every other branch to a preview |
| QR code | `public/qr.svg` (served at `/qr.svg`), encodes `https://musefriends.tech` |

## How deploys work

- Push to `main`: production deploy, served on `www.musefriends.tech`, `musefriends.tech`, and `muse-friends.vercel.app` within about a minute.
- Push to any other branch: a preview deploy with its own URL. **Previews are behind Vercel Authentication** (a Vercel login is required to open them). Only the production addresses (`www.musefriends.tech`, the redirecting `musefriends.tech`, and the primary alias `muse-friends.vercel.app`) are public; the team-scoped alias `muse-friends-aaron-sulbaran-projects.vercel.app` also redirects to a Vercel login. Always hand out and test one of the public addresses.
- This is a Hobby project, and Hobby limits Git deploys to the account owner's own commits (not yet tested here with a second author). If a push from someone else never produces a deployment, deploy from the owner's machine with `vercel --prod`.
- Environment variables apply to new deployments only. After adding or changing one, redeploy (H1 step 4).

CLI, from the repo root of a linked checkout (`vercel link --yes --project muse-friends --scope aaron-sulbaran-projects` once per checkout; the link folder `.vercel/` is gitignored):

```bash
vercel ls muse-friends          # recent deployments and their state
vercel logs <deployment-url>    # runtime logs of one deployment
vercel inspect <deployment-url> # build details
```

## Regenerating the QR code

Run this whenever the production address changes, then commit `public/qr.svg`. It last changed on Sat Oct 24 evening, when `musefriends.tech` went live; before that it encoded the vercel.app address.

```bash
pnpm dlx qrcode@1.5.4 -t svg -e M -q 2 -o public/qr.svg "https://musefriends.tech"
```

Check it by pointing a phone camera at the file opened on screen; it must open the address in a private window with no login, passing through one redirect to `www`.

## Human steps

**H1 and H3 in one sitting (Aaron, 5 minutes).** Everything production needs from your keys, in order:

1. Add two lines to `code/.env` (values from the Supabase dashboard, see H3 step 2): `SUPABASE_URL=https://egzeidhihiimurkinzyb.supabase.co` and `SUPABASE_SERVICE_ROLE_KEY=<the secret key>`. `MODEL_API_KEY` is already there.
2. From the `code` folder: `./scripts/push-env-to-vercel.sh --dry-run`. Expect four names with character counts: `MODEL_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, and `STORE` (set to `supabase` in Vercel only), and `dry run only; nothing was changed.` If it complains that only one Supabase variable is set, fix `.env` first.
3. `./scripts/push-env-to-vercel.sh`, then Redeploy the production deployment (H1 step 4).
4. Tell the platform lane; it runs the live round trip and reports latency.


### H1. Push the secrets into Vercel (Aaron, 3 minutes)

Production needs `MODEL_API_KEY` for the agents (and, later, the Supabase variables, see H3), plus the two MCP tokens once the connector test is on. One script copies what is set in `code/.env` to the Vercel project for Production and Preview, stored as Sensitive, and never prints a value. Do this before the P1 checkpoint (Sun 12:00am).

1. In a terminal, from the `code` folder (the checkout that holds your real `.env`): `./scripts/push-env-to-vercel.sh --dry-run`. Expect names with character counts and `dry run only; nothing was changed.`
2. Run `./scripts/push-env-to-vercel.sh`. Expect `pushed MODEL_API_KEY (49 characters, secret)`. If the Vercel CLI asks which Git branch a Preview variable is for, press Enter (all branches).
3. Check: `vercel env ls` lists `MODEL_API_KEY` for Production and Preview.
4. Redeploy so the running deployment picks it up: open https://vercel.com/aaron-sulbaran-projects/muse-friends, **Deployments**, the latest production deployment, **...**, **Redeploy**, confirm. Expect Ready in about 30 seconds. (Any merge to `main` also redeploys.)

If the connector test (H4) is on: add `--with-mcp-tokens` to step 2 (it generates `MCP_TOKEN_A` and `MCP_TOKEN_B` into `.env` first), and after the redeploy run `./scripts/mcp-smoke.sh`; expect five `PASS` lines and `all checks passed.`

Dashboard fallback if the script fails: https://vercel.com/aaron-sulbaran-projects/muse-friends/settings/environment-variables, **Add Environment Variable**, key `MODEL_API_KEY`, value from `.env` (the text after the `=`, no quotes), Environments **Production** and **Preview**, **Sensitive** on, **Save**; then redeploy as in step 4. Re-run the script (or repeat the dashboard steps) whenever a new variable is added to `.env`.

### H2. Connect musefriends.tech: done by Aaron (live Sat Oct 24 evening)

Canonical address: **https://www.musefriends.tech**. The bare name `https://musefriends.tech` redirects to it with a 308 (set in the Vercel project, Settings, Domains), so the QR code, which encodes the bare name, costs a phone one extra hop and lands on `www`. Both names are verified in the Vercel project and have certificates. The domain stays on the registrar's nameservers; the records live in the get.tech DNS editor.

DNS records Vercel shows for this project, as set:

| Type | Name | Value |
|---|---|---|
| A | `@` | `216.198.79.1` |
| CNAME | `www` | `02c1d9a5bffce12d.vercel-dns-017.com.` |

Vercel also accepts `64.29.17.1` (second IP) or the older `76.76.21.21` for the apex, and `cname.vercel-dns.com.` for `www`. Checked on Sat Oct 24 against the registrar's own nameservers and against 8.8.8.8, 1.1.1.1, and 9.9.9.9: all return the two values above.

To redo it on a fresh project:

1. Open https://vercel.com/aaron-sulbaran-projects/muse-friends/settings/domains. Add `www.musefriends.tech`, then add `musefriends.tech` and choose to redirect it to `www.musefriends.tech`.
2. Copy the records Vercel shows into the get.tech DNS editor, deleting any parking record on `@` or `www`.
3. Wait up to 30 minutes; both names turn to a check mark and certificates are issued on their own.
4. In a private window on a phone, `https://musefriends.tech` must land on `https://www.musefriends.tech` with a lock icon.
5. Regenerate the QR code if the address changed (section above).

One quirk to know about: when I looked, Vercel's own domain check (`vercel api /v6/domains/musefriends.tech/config`) still said `misconfigured: true` with a conflicting `A 127.0.0.1` on the bare name, although the registrar's nameservers and all three public resolvers return the right record and both names serve. I treat it as stale on Vercel's side. If the bare name ever misbehaves, look for a leftover `A 127.0.0.1` on `@` in the DNS editor and delete it.

### H3. Supabase: hand over the server key (Aaron, 3 minutes; the schema is applied)

The production store has to survive across stateless function calls; local development keeps the JSON file. The project exists: `muse-friends`, ref `egzeidhihiimurkinzyb`, us-east-1 (next to Vercel's `iad1`). The ref and the URL are not secrets.

0. Create the project: **done by Aaron at 8:35pm** (nothing else was set up inside it).
1. Apply the schema: **done** (applied by the platform lane on Sat Oct 24, about 8:55pm, with Aaron's approval). Checked: 14 tables, each with RLS on and no policies; the `anon` and `authenticated` roles are denied on every table and function; `store_snapshot` and `store_replace_all` round-trip real fixture data inside a transaction that was rolled back, and the database was verified empty afterwards. To reapply on a fresh project, paste the whole of `supabase/migrations/20261025010000_store.sql` into https://supabase.com/dashboard/project/egzeidhihiimurkinzyb/sql/new and click **Run**.
2. Hand over the server key. Open https://supabase.com/dashboard/project/egzeidhihiimurkinzyb/settings/api-keys and copy the **secret** key (starts `sb_secret_`; the legacy **service_role** key works the same). Never paste it into chat, a doc, or git. Add these two lines to `code/.env`:
   ```
   SUPABASE_URL=https://egzeidhihiimurkinzyb.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<the secret key>
   ```
3. Push them to Vercel with H1's script (`./scripts/push-env-to-vercel.sh`); when both Supabase lines are present it also sets `STORE=supabase` in Vercel, and only there. Then redeploy as in H1 step 4. Do not put `STORE` in `.env`: local development leaves it unset and uses the JSON file.
4. Check the real project from your machine: `SUPABASE_LIVE_TEST=1 pnpm test tests/supabase-store.live.test.ts`. It round trips a thread, messages, a plan, cards, events, the rejected-window ledger, signals and a recorded run under throwaway ids, deletes them, and prints the latency of each call. It never touches live demo rows.

### H4. Connect test of a real Muse (Aaron at the laptop, about 2:30am, 15 minutes, a stopwatch)

What it decides: whether an optional "Connect your own Muse" side path exists. It is **not** part of the scripted demo (research R1: no-go as a segment, because setup is about 4 minutes against a 3 minute pitch and nothing about Muse's connector builder is verified). The web sandbox is the product either way. Do not claim anything about a connected Muse until this passes twice.

What the server offers: a bearer-protected MCP endpoint with one read-only tool, `get_status`, at **https://www.musefriends.tech/api/mcp**, and a plain REST mirror of the same answer at **https://www.musefriends.tech/api/connector/status** (one source says Muse's connector builder may only speak REST). Use the `www` address, not the bare name: the bare name answers with a 308 redirect, and a client that does not follow a redirect on a POST would fail there. `get_status` returns whether the store is reachable and counts of threads, messages, plans, cards, and activity rows, never their content. It stays closed (always 401) until the tokens exist.

Set up the keys (5 minutes):

1. From the `code` folder: `./scripts/push-env-to-vercel.sh --with-mcp-tokens`. It generates `MCP_TOKEN_A` and `MCP_TOKEN_B` into `.env` if missing and pushes them to Vercel as Sensitive. Redeploy production (H1 step 4).
2. `./scripts/mcp-smoke.sh`. Expect five `PASS` lines: no key is refused, the key is accepted and `get_status` is listed, `get_status` answers, and the same two checks for the REST mirror. Run it once with `b` as the second argument to check the second key.
3. Open `.env` and copy the value of `MCP_TOKEN_A` when Muse asks for it. Never paste it into chat, a doc, or git. These are throwaway keys; both can be regenerated by deleting them from `.env` and running step 1 again.

The test (your own Muse account; US, 18 or older; stopwatch started when you send the first message):

1. New Muse chat. Paste this one line: `connect to the Muse Friends MCP server at https://www.musefriends.tech/api/mcp, bearer token, tool get_status`. Answer any prompt the way a judge could (HTTP, bearer); paste the key into Muse's secure credential prompt. Stop the clock at "connected".
2. Ask: `call get_status`. Pass: Muse shows the result, with `ok: true`, `service: muse-friends`, `account: a`, and the store counts.
3. Open a fresh chat and ask: `call Muse Friends get_status`. Pass: it works without connecting again (it persists).
4. Ask: `in 5 minutes call Muse Friends get_status and tell me`. Pass: five minutes later Muse reports on its own.
5. Repeat steps 1 to 3 on muse.ai in a browser, and note any card or usage-limit prompt.

**Pass:** connected in under 3 minutes, result shown, persists, and all of it twice (the app and the web). **If Muse refuses MCP:** retry with the REST mirror, same key: `connect to the Muse Friends API at https://www.musefriends.tech/api/connector/status, bearer token, GET`.

Report to the orchestrator: the time to connect, the exact prompts Muse asked, whether each step passed, and any card or usage-limit prompt. Leave account details out. If it fails, the server logs one line per request (`mcp auth scheme=... accepted=...` or `connector auth scheme=... accepted=...`, never the key), so the platform lane can tell whether Muse reached us, which header it sent the key in, and whether the key matched. If it passes, the only claim allowed is "it ran in a real Muse through a private custom connector, which Meta does not review". Never claim native Muse-to-Muse traffic, a listed connector, or that it shipped. `start_plan` is not built, and is not part of this test.

## Smoke test 7: the production URL on a real phone

Who: anyone with a phone. Time: 5 minutes. Run it on venue Wi-Fi and again on mobile data, in a private tab.

0. Optional first pass from a laptop on the same network: `./scripts/smoke-production.sh`. Expect seven `PASS` lines (health, home, both phones, the QR file, the stylesheet, the state JSON), none over 3 seconds, none redirected to a Vercel login. It does not run the negotiation; that is step 3, on a phone.
1. Scan the QR code (open https://musefriends.tech/qr.svg on another screen) or type the address.
2. Use a public address only: `https://musefriends.tech` (it redirects to the canonical `https://www.musefriends.tech`, so expect the address bar to end on `www`) or the fallback `https://muse-friends.vercel.app`. The agents post to each other at the origin of the request that started them, so a preview or the team-scoped alias, which sit behind a Vercel login, would put a login wall in front of the second hop and the negotiation would stall. After the redirect the origin is `www`, which is public too.
3. Run one negotiation. Open `/a`, tap **Play with a simulated friend**, wait for the plan card, tap **Reach out**. Pass: no Vercel login; the card appears within about 30 seconds; the other side answers on its own within seconds and the status line moves to waiting for Michelle and then to the WhatsApp step; nothing stalls and nothing takes anywhere near 300 seconds. With a second phone on `/b` instead of the simulated friend, that phone's person taps the card.
4. Clean up, every time. In **Demo controls** on the stage page tap **Reset**, then turn the simulated friend off (the stage control, or `curl -X POST https://www.musefriends.tech/api/controls -H 'content-type: application/json' -d '{"type":"simulated_friend","on":false}'`). Reset keeps the simulated-friend setting on purpose, so a solo test otherwise leaves the next two judges with a model-played friend.
5. Fail: write down which network, what you saw, and the time, and send it to the orchestrator.

First full run (Sat Oct 24, about 9:50pm, Wi-Fi, 375 px window, production `b5d41bd`): the tap to a plan awaiting both people took about 15 seconds (reel read at about 3 seconds, first agent message at about 12, third at about 17 on a polling clock), the simulated friend answered within a few seconds of the tap, the plan was confirmed, and the database held 1 signal, 1 thread, 3 messages, 1 plan, 2 cards, and 10 timeline events. Replay played from the stage's Demo controls.

## Installing the app on a phone

The site is installable: `app/manifest.ts` (name Muse Friends, standalone, start page `/`, the phone screen color for window and splash), 192 and 512 pixel icons in `public/icons/` rendered from `app/icon.svg`, and `appleWebApp` metadata so iOS titles the Home Screen icon "Muse Friends". There is no service worker, no offline mode, and no push; installing only adds an icon and a window without browser chrome.

- **iPhone:** Safari, Share, **Add to Home Screen**. (`beforeinstallprompt` does not exist on iOS, so there is no in-page install button.)
- **Android:** Chrome menu, **Install app**.

Verified on the local server (Sat Oct 24, about 12:40am): the manifest is served as `application/manifest+json`; Chrome fetches it, raises no manifest issues, and decodes both icons at their declared sizes; no service worker is registered; `/` passes the smoke script. **Not verified: a real iPhone.** Before saying "installable" anywhere (README, Devpost, the pitch), do the 5 minute check: add it from Safari, open the Home Screen icon, run one negotiation, tap **Open WhatsApp** and come back with the app switcher. If the standalone window traps navigation or WhatsApp does not open from it, say nothing about installing and keep the Copy button prominent.

## If production shows old styles after a deploy

Symptom: the stage renders black and unstyled (system font, dark mode), yet `/api/health` shows the new commit.

What happened (Sat Oct 24, about 8:45pm): production builds restore the previous production build cache. Twice in a row the Turbopack output for `app/globals.css` (processed by the Tailwind loader) stayed the old scaffold stylesheet while the HTML and JavaScript were new. Preview builds, whose cache came from a different lineage, produced the right stylesheet from the same source, and a clean local build did too.

Check, from anywhere:

```bash
curl -sL https://musefriends.tech/ | grep -o '/_next/static/[^"]*\.css'
curl -sL https://musefriends.tech/<the path printed above> | grep -c -- '--color-screen'
```

Expect a count of 1 or more. `./scripts/smoke-production.sh` runs the same check ("stylesheet carries the brand tokens").

Confirmed fixed (Sat Oct 24, about 8:56pm): the first production deploy after the change, commit `4326251`, served a 25,645 byte stylesheet containing `--color-screen` and no Geist, and `./scripts/smoke-production.sh` passed all seven checks. The build log still says "Restored build cache from previous deployment", then runs `rm -rf .next && pnpm run build`, so the restored cache is thrown away before the compiler sees it.

Fix: `vercel.json` now builds with `rm -rf .next && pnpm run build`, so no restored cache can reach the compiler and every deploy is a clean build (it adds a few seconds). If it ever happens anyway, open the Vercel project, **Deployments**, the latest production deployment, **...**, **Redeploy**, untick **Use existing Build Cache**, **Redeploy**, then rerun the check. Also confirm you opened a public address (`https://musefriends.tech` or `https://muse-friends.vercel.app`) and not a preview or a team-scoped alias, which sit behind a login and can lag.

