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

## Deploy quota

The Hobby plan allows **100 deployments per day**, and every push counts: each push to any branch builds a preview, each merge to `main` builds production, and a CLI deploy counts too. On Sun Oct 25 at 12:36am Central the team hit the cap and Vercel started refusing builds.

**Today's numbers** (counted at 12:48am Central with the command below): this project had 91 deployments in the previous 24 hours, the first at Sat 8:17pm and the last at Sun 12:36am. 32 were production (31 from `main`), 59 were previews (88 ready, 3 canceled). By 12:54am it was 92 and 33 production. The cap is counted per team, so other projects on the "Aaron's Personal Projects" team add to it; I did not count those.

**What it looks like:**

- The `Vercel` check on a pull request fails with "Deployment rate limited, retry in 24 hours."
- `vercel deploy` from the CLI answered `Resource is limited - try again in 24 hours (more than 100, code: "api-deployments-free-per-day")`, so a CLI deploy is not a way around the cap (I did not try `vercel --prod`).
- Production keeps serving the last deployment that succeeded; a refused build leaves it where it was.
- **The cap did not behave like a hard daily wall.** Previews from three of the platform lane's branches were refused between about 12:38am and 12:50am, yet a batched merge to `main` (commit `3db196d`) deployed to production and went Ready at 12:53am, and the orchestrator saw previews build again around 12:56am. We do not know whether production is exempt or the limit is a rolling counter that freed a slot. Plan as if any build can be refused, and check production's commit after every merge: `curl -s https://www.musefriends.tech/api/health` shows the deployed `sha`.

**The fix, if builds keep being refused, is the Pro step (about 2 minutes, works from a phone):** open https://vercel.com/aaron-sulbaran-projects?upgradeToPro=build-rate-limit, or in Vercel switch to the team "Aaron's Personal Projects", then **Settings**, **Billing**, **Upgrade to Pro** (take the free trial if it is offered). Pro raises the cap to 6000 deployments a day and also allows a cron every 15 minutes instead of once a day. I have not seen the upgrade take effect, so check it: push anything or **Redeploy** the latest production deployment, then `vercel ls muse-friends` should show a new Ready deployment, the pull request check should turn green, and `./scripts/smoke-production.sh` should pass. The first deploy after the cap lifts builds the latest `main`, so everything merged while it was capped goes live in that one.

**While it is capped:** batch merges into as few as possible (one local gate of lint, typecheck, test, and build over several pull requests, then one merge window); do not push small commits to open branches; leave the project settings alone (turning preview deployments off would also take the lanes' checks away once the cap is raised). If the cap cannot be raised before judging, the fallback from the build plan is one laptop behind a tunnel with the JSON store.

**Count it yourself** (read-only; a result near 100 means the team is at the cap, and other projects add to it):

```bash
vercel api "/v6/deployments?app=muse-friends&since=$(( ($(date +%s) - 86400) * 1000 ))&limit=100" --scope aaron-sulbaran-projects > /tmp/deploys.json
python3 -c 'import json; d=json.load(open("/tmp/deploys.json"))["deployments"]; print(len(d), "deployments,", sum(1 for x in d if x.get("target")=="production"), "production")'
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

Production needs `MODEL_API_KEY` for the agents (and, later, the Supabase variables, see H3). One script copies what is set in `code/.env` to the Vercel project for Production and Preview, stored as Sensitive, and never prints a value. Do this before the P1 checkpoint (Sun 12:00am).

1. In a terminal, from the `code` folder (the checkout that holds your real `.env`): `./scripts/push-env-to-vercel.sh --dry-run`. Expect names with character counts and `dry run only; nothing was changed.`
2. Run `./scripts/push-env-to-vercel.sh`. Expect `pushed MODEL_API_KEY (49 characters, secret)`. If the Vercel CLI asks which Git branch a Preview variable is for, press Enter (all branches).
3. Check: `vercel env ls` lists `MODEL_API_KEY` for Production and Preview.
4. Redeploy so the running deployment picks it up: open https://vercel.com/aaron-sulbaran-projects/muse-friends, **Deployments**, the latest production deployment, **...**, **Redeploy**, confirm. Expect Ready in about 30 seconds. (Any merge to `main` also redeploys.)

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

### H4. Connect Muse to the endpoint (Lisa, 30 minutes)

Added when the MCP front door is deployed; see the next section of this runbook then.

## Smoke test 7: the production URL on a real phone

Who: anyone with a phone. Time: 5 minutes. Run it on venue Wi-Fi and again on mobile data, in a private tab.

0. Optional first pass from a laptop on the same network: `./scripts/smoke-production.sh`. Expect seven `PASS` lines (health, home, both phones, the QR file, the stylesheet, the state JSON), none over 3 seconds, none redirected to a Vercel login. It does not run the negotiation; that is step 3, on a phone.
1. Scan the QR code (open https://musefriends.tech/qr.svg on another screen) or type the address.
2. Use a public address only: `https://musefriends.tech` (it redirects to the canonical `https://www.musefriends.tech`, so expect the address bar to end on `www`) or the fallback `https://muse-friends.vercel.app`. The agents post to each other at the origin of the request that started them, so a preview or the team-scoped alias, which sit behind a Vercel login, would put a login wall in front of the second hop and the negotiation would stall. After the redirect the origin is `www`, which is public too.
3. Run one negotiation. Open `/a`, tap **Play with a simulated friend**, wait for the plan card, tap **Reach out**. Pass: no Vercel login; the card appears within about 30 seconds; the other side answers on its own within seconds and the status line moves to waiting for Michelle and then to the WhatsApp step; nothing stalls and nothing takes anywhere near 300 seconds. With a second phone on `/b` instead of the simulated friend, that phone's person taps the card.
4. Clean up, every time. In **Demo controls** on the stage page tap **Reset**, then turn the simulated friend off (the stage control, or `curl -X POST https://www.musefriends.tech/api/controls -H 'content-type: application/json' -d '{"type":"simulated_friend","on":false}'`). Reset keeps the simulated-friend setting on purpose, so a solo test otherwise leaves the next two judges with a model-played friend.
5. Fail: write down which network, what you saw, and the time, and send it to the orchestrator.

First full run (Sat Oct 24, about 9:50pm, Wi-Fi, 375 px window, production `b5d41bd`): the tap to a plan awaiting both people took about 15 seconds (reel read at about 3 seconds, first agent message at about 12, third at about 17 on a polling clock), the simulated friend answered within a few seconds of the tap, the plan was confirmed, and the database held 1 signal, 1 thread, 3 messages, 1 plan, 2 cards, and 10 timeline events. Replay played from the stage's Demo controls.

## Scheduled sweep (cron)

`GET /api/cron/sweep` moves plans along in **real time**: for each plan, the next step (the reminder two hours before the plan, the end, the next-day follow-up) is run if its moment has already passed. It decides nothing itself: `nextStepDue` and `advanceClock` in `lib/agent/lifecycle.ts` say which step is due and run it, the same functions the demo clock uses. One step per call, and each transition writes one Activity row stamped `Scheduled sweep: <title> moved from <state> to <state>`. Idempotent: a moved plan has no due step, so a second run or a duplicate delivery finds nothing to do. It returns counts as JSON: `{"data":{"at","checked","advanced","skipped","transitions":[...]},"error":null}`.

**Closed by default.** It needs `Authorization: Bearer <CRON_SECRET>`, which Vercel Cron sends on its own when the project has a `CRON_SECRET` environment variable. Without a secret (unset or under 16 characters) every request answers **503**; with a wrong or missing bearer it answers **401**. Nothing runs either way.

**Schedule.** `vercel.json` has one entry, `0 14 * * *`: once a day at 14:00 UTC (9:00am Central), which is the most the **Hobby** plan allows (this project is on Hobby; checked with `vercel teams ls`). Hobby runs it any time in that hour, plus or minus up to 59 minutes, and an expression that fires more than daily fails the deploy. On Pro it could be every 15 minutes. Cron jobs run only on **production** deployments.

**What you will and will not see.** The seeded plan is Tuesday Oct 27, 6 to 8pm Central, so its first real-time step (the reminder) is due Tuesday at 4:00pm. Before then a run finds nothing due and writes nothing. Do not say the app "reminds people" on Sunday; the true statement is that a scheduled run exists, runs daily, is idempotent, and is covered by tests (unauthorized, closed when unset, idempotent on a second call, the Scheduled stamp).

### H5. Give the sweep its secret (Aaron, 2 minutes, with H4's key push if you are doing it)

The secret has to be added from a machine with your Vercel login; the platform lane's session is not allowed to write secrets.

1. From the `code` folder: `./scripts/push-env-to-vercel.sh --dry-run --with-cron-secret`. Expect `would generate CRON_SECRET into .env` and `would push CRON_SECRET (64 characters, secret)` in the list.
2. `./scripts/push-env-to-vercel.sh --with-cron-secret` (add `--with-mcp-tokens` too if you are also doing H4). It generates `CRON_SECRET` (32 random bytes, hex) into `.env`, never prints it, and pushes it to Vercel for Production and Preview.
3. Redeploy production (H1 step 4).
4. Check, with no secret needed: `curl -i https://www.musefriends.tech/api/cron/sweep`. Expect `HTTP/2 401` (the secret exists and you did not send it). A `503` means the secret did not reach this deployment; redeploy.
5. Check the schedule is registered: https://vercel.com/aaron-sulbaran-projects/muse-friends/settings/cron-jobs lists `/api/cron/sweep` at `0 14 * * *`. Its **Run** button calls the route with the right header; with no plan due it reads the store and writes nothing.

## Installing the app on a phone

The site is installable: `app/manifest.ts` (name Muse Friends, standalone, start page `/`, the phone screen color for window and splash), 192 and 512 pixel icons in `public/icons/` rendered from `app/icon.svg`, and `appleWebApp` metadata so iOS titles the Home Screen icon "Muse Friends". There is no service worker, no offline mode, and no push; installing only adds an icon and a window without browser chrome.

- **iPhone:** Safari, Share, **Add to Home Screen**. (`beforeinstallprompt` does not exist on iOS, so there is no in-page install button.)
- **Android:** Chrome menu, **Install app**.

Verified on the local server (Sun Oct 25, about 12:40am): the manifest is served as `application/manifest+json`; Chrome fetches it, raises no manifest issues, and decodes both icons at their declared sizes; no service worker is registered; `/` passes the smoke script. Verified on production too (commit `3db196d`, Sun Oct 25 about 12:55am), on `www.musefriends.tech`, `musefriends.tech`, and `muse-friends.vercel.app`: the manifest is served as `application/manifest+json`, both icons come back as PNGs of exactly 5969 and 22106 bytes, the page head has the manifest link and the apple web-app title, and `./scripts/smoke-production.sh` passes 7 of 7. **Not verified: a real iPhone.** Before saying "installable" anywhere (README, Devpost, the pitch), do the 5 minute check: add it from Safari, open the Home Screen icon, run one negotiation, tap **Open WhatsApp** and come back with the app switcher. If the standalone window traps navigation or WhatsApp does not open from it, say nothing about installing and keep the Copy button prominent.

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

