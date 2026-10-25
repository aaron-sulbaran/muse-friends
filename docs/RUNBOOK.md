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

## C5 and C6 gates

The merge gate (C5, Sun Oct 25 6:30am: merge reach work only if the merged build passes the core run twice and Replay plays, else revert to the core-green tag) and the freeze check (C6, 8:30am) are one command:

```bash
pnpm gate:c5 --base https://www.musefriends.tech --expect-sha <first 7 characters of the commit you merged>
```

Run it against production after the merged `main` has deployed. `--expect-sha` makes the first step fail unless production serves that exact commit, so a deploy that has not landed (or that the deploy cap refused, see "Deploy quota") is reported instead of an old build being tested. Use the `www` address.

**What it runs, in order, one PASS or FAIL line each:**

1. Health answers ok and shows the deployed commit (`/api/health`, `sha`), and matches `--expect-sha` when given.
2. The demo room is free: no plan, no messages, and no agent turn running. A busy room is refused and nothing is touched.
3. The simulated friend is off (`demo:http` taps both people itself); if it was on, the gate turns it off.
4. The shawarma scenario through `scripts/demo-http.mjs` (the existing `pnpm demo:http`), twice by default: signal, agents agree within 4 messages with model proof, both people accept, WhatsApp draft and hold, clock to the reminder and the next day, "We went!", Follow-through counts one human event.
5. The privacy toggle check `demo:http` already performs, once per run: location off for Mochi, and the redaction shows on the replayed messages.
6. Replay: `GET /api/replay` parses, every frame is a replay snapshot with a hold time, and the last frame carries messages 1 to N (at least three).
7. The demo room is left reset: empty, simulated friend off. This step runs even when an earlier one failed, and waits for a running agent turn to finish first.

The last line is `C5 GATE: PASS` or `C5 GATE: FAIL (k of n steps failed)`. Exit code **0** when every step passes, **1** when any fails or the app does not answer, **2** when the room is busy and `--force` was not given (nothing was touched).

**Options:** `--base URL` (default `https://www.musefriends.tech`), `--expect-sha SHA`, `--runs N` (default 2), `--timeout SECONDS` per run (default 120), `--force` (clear a busy room; it waits up to 20 seconds for a running agent turn to finish first), `--verbose` (print every `demo:http` run in full instead of only the last 30 lines of a failing one).

**What it touches.** Only the demo room, the one room the app has, and only through the app's own controls route: `demo:http` resets it at the start and the end of every run. It spends real Muse Spark calls (about 15 to 25 seconds to agreement per run). Do not run it while a judge or a teammate is using the room.

**When a step fails:** the failing `demo:http` run's output follows the FAIL line. Usual causes: the room is paused by a run cap (the output says so; wait or reset), a model call was slow or refused (the scripted fallback sent a message without proof, so "every message carries model proof" fails; look at the Vercel runtime logs), the commit step failed because the deploy has not landed (see "Deploy quota"), or Replay failed because a recorded run in the store is malformed.

**Verified (Sun Oct 25, about 1:15am):** against a local server on the JSON store with live Muse Spark, `pnpm gate:c5 --base http://localhost:3003` passed all 9 steps in 42 seconds (agreement in 3 messages at 19.9 and 14.3 seconds, location redacted on both runs, Replay of 17 frames and 6 messages, room left reset). Exit codes checked: 0 on a pass, 1 for an unreachable server, 2 for a room with an agent turn running; `--force` waited for that turn and then passed. A fake app and fake `demo:http` scripts cover the failure paths in `tests/gate-c5.test.ts`. **Not run against production yet:** its first production run is the real C5.

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

Report to the orchestrator: the time to connect, the exact prompts Muse asked, whether each step passed, and any card or usage-limit prompt. Leave account details out. If it fails, the server logs one line per request (`mcp auth scheme=... accepted=...` or `connector auth scheme=... accepted=...`, never the key), so the platform lane can tell whether Muse reached us, which header it sent the key in, and whether the key matched. If it passes, the only claim allowed is "it ran in a real Muse through a private custom connector, which Meta does not review". Never claim native Muse-to-Muse traffic, a listed connector, or that it shipped. `start_plan` is a separate, optional step (see "Bring your own Muse" below), and is not part of this test.

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

## Bring your own Muse (judge connector)

An optional side path, not part of the scripted demo and never a headline: a judge connects their own Muse to a **private room** where it plays Sprout, the judge's side, against Mochi, a fictional friend played by a model. The only claim it supports is "it ran in a real Muse through a private custom connector, which Meta does not review, and it is a proposal for Muse, not a shipped feature". It builds on H4 and stays closed until H6 below.

**Nothing personal goes in (research R4).** The handbook forbids collecting personal information without written consent, and a judge's real availability would likely count. So the judge's Muse chooses a **preset** of fixed, fictional free time that we define in `app/api/connector/_lib/presets.ts` and print on `/connect`; it cannot send free text or windows of its own. The only inputs anywhere are a preset name, a plan id and accept or decline. Nothing about the person is stored: no name, no account label beyond the key's role (`judge`), no free text.

**The link path (D25), the primary station.** No key and no connector: the person at the table presses **Get a link for my Muse** on `/connect` (or staff call `GET /api/connector/code` with the judge key), which mints a short code (7 characters, lowercase letters and digits with no i, l, o, 0 or 1) and a sentence to paste into the judge's own Muse: `Open https://www.musefriends.tech/j/<code>, check which proposed times I'm free for, pick the ones that work, and show me the plan before approving`. The judge's Muse opens `/j/<code>` in its own browser, which is plain server-rendered HTML (no script, no cookie, native controls): six fixed fictional times as checkboxes named `slot` (`tue-18`, `wed-18`, `thu-19`, `fri-12`, `sat-11`, `sat-19`), a native **Send my picks** submit (`POST /j/<code>/start`, then a 303 back to the page). The ticks become Sprout's free time and a fixed fictional calendar becomes Mochi's; the server accepts only those six ids, at least one, and at least one must be a time Mochi can also do (Wednesday is the decoy she cannot), so a real calendar never reaches us, only which boxes were ticked. Reloading the page shows the plan as it stands (negotiating, then the agreed window and the drafted message with native **Approve** and **Decline** buttons, `POST /j/<code>/answer`, then a confirmation line). A code names one room and one plan, lasts 2 hours (404 for a code that is not valid or was purged, 410 for one that just expired), is minted under the same 10 rooms an hour cap, and is closed (404) unless `MCP_TOKEN_JUDGE` is set, because the code stands in for the key. **The table screen:** open `https://www.musefriends.tech/?room=<code>` on the laptop; the stage already polls `/api/state?room=<code>` from its address, and the server now answers that call from the judge's room when the code is live (any other `room` value, including a phone's, still gets the demo room). It is a read-only view: the stage's Demo controls would still act on the demo room, so do not press them while watching a judge's room (Lane B can hide them when `?room=` is a judge code).

**What it adds.** Three tools beside `get_status` on the same MCP endpoint (`/api/mcp`), mirrored as REST under `/api/connector/`, all behind one shared judge key, `MCP_TOKEN_JUDGE`. The key is accepted as `Authorization: Bearer <key>`, as the raw key in `Authorization`, or as `x-api-key` (we do not depend on the last two). The team's own keys (`MCP_TOKEN_A`, `B`) are refused on the three new tools (403): they are for `get_status` only. The page `/connect` is also the docs page the REST connect message points Muse at: the disclosure, the two copyable connect messages, the key behind a Copy button (read from the environment at request time, never in the repo), the three presets with their windows, and for each of the four tools its class (Read or Write), input, output, side effects, errors and limits.

| Tool | REST | Input | Answer |
|---|---|---|---|
| `start_plan` (Write) | `POST /api/connector/start_plan`, 202 | `{ slots: "evenings" or "lunches" or "weekend" }`, nothing else; any other key is refused (400) and not echoed back | `{ planId, contextId, state: "negotiating", you: "Sprout", friend: "Mochi (a fictional friend played by a model)", slots, free_windows, expires_in_minutes: 120, how_to_check }` |
| `check_plan` (Write, inside that room only) | `GET /api/connector/check_plan?planId=...` (or POST `{ planId }`) | `{ planId }` | `{ planId, state, plan_state, activity: { title, place }, messages: [{ seq, from, to, type, note, windows, policy: { shared, withheld, windows_dropped } }], agreed_window: { start, end, label }, decisions: { you, mochi }, whatsapp_draft, whatsapp_link, dropped_reason, next }`. `state` is `negotiating`, `awaiting_you`, `waiting_for_mochi`, `confirmed`, `dropped` or `stalled`; `next` says what to do |
| `respond` (Write) | `POST /api/connector/respond` | `{ planId, decision: "accept" or "decline" }` | The same view as `check_plan`, plus `you_answered`. 409 `not_waiting_for_you` until the agents agree or once answered; 404 for an unknown or expired plan |

The link path adds one more route, `GET /api/connector/code` (judge key; `POST` also works): `{ data: { code, expires_in_minutes: 120, link, table_screen, sentence }, error: null }`.

`get_status` (Read) is unchanged. `check_plan` is marked Write because it can record the fictional friend's pending answer in the room; it never sends anything to anyone.

The presets, US Central, all inside the demo calendar (Oct 26 to Oct 31), whole hours, each with at least an hour both Sprout and Mochi are free (a test checks it): **evenings** (Sprout Tue 6 to 9pm, Wed 6 to 8pm, Thu 7 to 10pm; Mochi Tue 5 to 8pm, Thu 7 to 10pm), **lunches** (Sprout Mon, Tue and Fri 12 to 2pm; Mochi Tue 12 to 1pm, Fri 1 to 3pm), **weekend** (Sprout Sat 10am to 2pm and 6 to 10pm; Mochi Sat 11am to 1pm and 7 to 10pm). Each room sets both calendars to exactly these windows (a marker per person, `room_calendar_<agent>`, in `lib/agent/calendar.ts` switches off the personas' seeded events for judge rooms only). After Oct 31 `start_plan` answers 422 `slots_expired`.

Every REST answer is `{ "data": ..., "error": null }` or `{ "data": null, "error": { "code", "message" } }`. Refusals worth knowing: 400 `bad_input` (anything but a known preset, any extra key, a missing or oversize plan id), 401 and 403 (key), 404 `no_such_plan`, 409 `not_waiting_for_you`, 422 `slots_expired`, 429 `room_cap` (with `Retry-After`) and `runs_paused`, 503 `rooms_unavailable` (the `byom_rooms` table is missing or unreachable).

**How it stays inside bounds.**

- **Isolation.** Each plan is a room of its own: a fresh in-memory store, saved as one JSON document in the `byom_rooms` table (an in-memory map locally), keyed by an unguessable plan id. The code never calls `getStore()`, so it cannot read or write the demo room, and the stage's Reset cannot reach a judge's plan either (`tests/byom.test.ts` checks the demo store and its file through a whole plan, and that no connector source names `getStore`).
- **Caps.** At most 10 new rooms per hour across all judges (`BYOM_ROOMS_PER_HOUR`, counted in the table, so it holds across instances), plus the existing run caps: a plan costs 2 runs (`start_plan`, `respond`) under the room name `byom`, and **those also count against the app-wide 60 per hour that the demo uses**. At 10 rooms an hour that is at most 20 of the demo's 60, never all of them; raise `MAX_LIVE_RUNS_PER_HOUR` in Vercel if you want more headroom.
- **Expiry and deletion.** A room is never served after 2 hours: `check_plan` and `respond` answer 404 for it. Expired rows are deleted the next time anyone starts a plan; that is cheaper than a second cron job (the Hobby plan has one daily slot, already taken by the sweep). Rows are not guaranteed to vanish at the 2 hour mark, so **when the expo ends run `node scripts/purge-judge-rooms.mjs --yes`** (below), which deletes every judge room.
- **What is stored.** Only fictional content: the preset's windows as busy blocks, the seeded reel, the agents' short notes, the plan and its draft. Nothing the caller typed is ever accepted, so nothing of the caller's can be stored.
- **What is still logged.** Muse reaches us from Meta's cloud, and Vercel keeps ordinary request logs (times, paths, addresses) that this project does not control and that `purge-judge-rooms.mjs` does not touch. The page therefore never says nothing is logged; it says the connector's own log lines show only the auth scheme and accepted yes or no, never the key.

### H6. Turn on Bring your own Muse (Aaron, 5 minutes, only if you want it live)

Nothing here is on by default; with `MCP_TOKEN_JUDGE` unset, `/connect` answers "not open" and every tool and route answers 401.

1. Create the table. Paste the whole of `supabase/migrations/20261025020000_byom_rooms.sql` into https://supabase.com/dashboard/project/egzeidhihiimurkinzyb/sql/new and click **Run** (or tell the platform lane in its own session to apply it to project `egzeidhihiimurkinzyb`; it will not do it on a message from another session). It creates one table, `byom_rooms`, with RLS on and the `anon` and `authenticated` roles denied. Skipping it is safe: `start_plan` then answers 503 `rooms_unavailable` and nothing else changes.
2. From the `code` folder: `./scripts/push-env-to-vercel.sh --dry-run --with-judge-token`, expect `would push MCP_TOKEN_JUDGE (48 characters, secret)`; then `./scripts/push-env-to-vercel.sh --with-judge-token` (it generates the key into `.env` and never prints it). Redeploy production (H1 step 4). Deploys count against the Hobby cap (see Deploy quota), so do this in one batch with other changes.
3. Check on the real URL: open https://www.musefriends.tech/connect in a private window. It must show the disclosure, **Get a link for my Muse**, the two tool messages, **Copy key**, and the three presets. Then `./scripts/byom-smoke.sh https://www.musefriends.tech`; expect twenty-two `PASS` lines and `all checks passed.` It creates two plans in the `byom_rooms` table (one through the tools, one through a link code; never the demo room), spends about 6 model calls, and checks that the demo room's content did not change. Do not run it while a judge is using the room.
4. The Muse side, link path first (Lisa rehearses this one): on `/connect` press **Get a link for my Muse**, copy the sentence into a new Muse chat, approve what Muse asks (those prompts are Muse's), and watch the plan on the table screen (`/?room=<code>`). Then, only if you want the connector story, the tool path as in H4, with the connect messages on `/connect`: open Muse, new chat, paste the first message (MCP) or the second (REST), put the key in Muse's secure credential prompt, approve what Muse asks (those prompts are Muse's), then say: `Use Muse Friends to start a plan for evenings, check on it until Sprout and Mochi agree, show me the plan and the drafted message, and only answer after I say yes.` Muse should call `start_plan`, `check_plan` until `awaiting_you`, show you the agreed time and the drafted message, and call `respond` when you say yes. Note the time to connect and what Muse asked, exactly as H4 does. Nothing here relies on Muse acting on a schedule or on its own: the page does not promise that.
5. When the expo ends (Sun Oct 25, about 11:30am), close it and clear the rooms. From the `code` folder, with the Supabase keys in `.env` (H3): `node scripts/purge-judge-rooms.mjs` counts the rooms (tool rooms and link rooms are in the same table) and deletes nothing; `node scripts/purge-judge-rooms.mjs --yes` deletes every one and counts again (expect `deleted N of N judge room(s); 0 remain.`). It prints the project host and counts, never a key, and touches only `byom_rooms`. Then remove `MCP_TOKEN_JUDGE` in Vercel (Settings, Environment Variables) and redeploy, which closes everything again. The key is public by design while `/connect` is open: anyone who opens the page can copy it, which is why the three tools can only spend model calls inside the caps above, accept nothing but a preset name, and never see the demo room or the team's data. Vercel's request logs still exist after this.

Local test, no Vercel and no production data: put `MCP_TOKEN_JUDGE` (24 or more characters) in `.env`, leave `STORE` unset (and `SUPABASE_*` unset, or the routes will try the real table), run `pnpm dev -p 3003`, and in another terminal `./scripts/byom-smoke.sh http://localhost:3003`. By hand, with the key on stdin so it never shows in the command or the output:

```bash
key="$(awk 'index($0, "MCP_TOKEN_JUDGE=") == 1 { printf "%s", substr($0, length("MCP_TOKEN_JUDGE=") + 1) }' .env)"
printf 'header = "Authorization: Bearer %s"\n' "$key" | curl -sS -K - -X POST http://localhost:3003/api/connector/start_plan \
  -H 'content-type: application/json' \
  -d '{"slots":"evenings"}'
```

Then the same pipe with `GET /api/connector/check_plan?planId=<the planId>` every few seconds until `state` is `awaiting_you` (about 15 seconds), and `POST /api/connector/respond` with `{"planId":"...","decision":"accept"}`.

**Verified (Sun Oct 25, about 2:15am and 2:45am, local dev server, JSON store, live Muse Spark):** all three presets over REST (agreed in 3, 4 and 3 messages; the lunches run had a counter-offer first), and `evenings` and `weekend` over MCP (`tools/list` shows four tools and `start_plan`'s schema allows exactly one property, `slots`, with `additionalProperties: false`; free text is refused by the MCP layer before our code runs; a team key is refused on the three new tools). The link path end to end in the Browser pane acting as a Muse would (press the button on `/connect`, open `/j/<code>`, tick two boxes, send, reload, press Approve) and with curl form posts: the plan agreed in about 15 seconds inside the ticked times and the page showed Confirmed after Approve. The table screen's `/api/state?room=<code>` returned the room's messages and plan, answered 304 on an unchanged ETag, and the demo room's state stayed empty. `./scripts/byom-smoke.sh http://localhost:3003` passes all twenty-two checks. `/connect` at 375 pixels: no sideways scroll. `scripts/purge-judge-rooms.mjs` is covered by tests against a stand-in client and was run with no Supabase keys to check it stops with a clear message. **One thing to know:** at about 2:35am `muse-spark-1.3` answered "404 model not found" on every call for several minutes (a transient flap; see "If the model answers 404"), so the local verification above ran with `MODEL_ID=muse-spark-1.2`. Check the model before any gate. **Not verified:** the `byom_rooms` migration applied to the real project, the purge script against the real table, a deployed preview or production run, a real Muse opening `/j/<code>` (Lisa's earlier test covered a public form, not this page), and Muse's real behavior with the connect messages.

## If the model answers 404

Symptom: agent turns come back from the scripted fallback with no model proof, a simulated friend never answers, and the logs say `404 The requested model was not found.` On Sun Oct 25 at about 2:35am `muse-spark-1.3` did this on every call for several minutes while `/models` still listed it and `muse-spark-1.2`, `1.1` and `1.3-contributor` answered; it was a transient flap, and about 25 minutes later `1.3` answered 200 again. The app already waits through it (eight retries over about 6 seconds, then the scripted fallback), so a short flap costs nothing worse than that.

**If the model 404s for more than five minutes on every call, set `MODEL_ID=muse-spark-1.2` in Vercel production and redeploy; confirm with three direct calls first.** The check, with the key on stdin so it never appears in the command or the output (prints only the model, the HTTP status and the time):

```bash
key="$(awk 'index($0, "MODEL_API_KEY=") == 1 { printf "%s", substr($0, length("MODEL_API_KEY=") + 1) }' .env)"
for model in muse-spark-1.3 muse-spark-1.3 muse-spark-1.3 muse-spark-1.2; do
  printf 'header = "Authorization: Bearer %s"\n' "$key" | curl -sS -m 30 -K - -o /dev/null -w "$model %{http_code} %{time_total}s\n" \
    -X POST https://api.meta.ai/v1/responses -H 'content-type: application/json' \
    -d "{\"model\":\"$model\",\"input\":\"say ok\",\"max_output_tokens\":16}"
done
```

Three `404` lines for `muse-spark-1.3` and `200` for `muse-spark-1.2` means switch; three `200` lines (about 1 to 2 seconds each) mean the flap is over and nothing changes. `MODEL_ID` is read by `lib/model.ts` on every call, so it is a Vercel environment variable (Settings, Environment Variables, Production, then Redeploy), not a code change; remove it again when `1.3` answers. Checked Sun Oct 25 about 3:00am: `1.3` answered 200 at 0.95, 1.94 and 1.76 seconds and `1.2` at 0.59 seconds.

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

