# Runbook: platform and deploy

How Muse Friends is hosted, and every step that needs a human with a dashboard login. Each human step has a number (H1, H2, ...), who does it, how long it takes, the exact clicks, and what you should see. Steps are listed in the order they unblock the build.

## Where things live

| Thing | Value |
|---|---|
| Production URL (QR code, judges, README) | https://musefriends.tech. The canonical address is **https://www.musefriends.tech**: the bare name answers with a 308 redirect to it, so the browser's address bar ends on `www` |
| Fallback address | https://muse-friends.vercel.app: public and always live; hand this one out if the domain ever misbehaves |
| Health check | https://musefriends.tech/api/health (after the redirect, https://www.musefriends.tech/api/health) returns `{"ok":true,"sha":"<7 chars>"}`; `sha` is the deployed commit |
| Vercel project | `muse-friends`, team "Aaron's Personal Projects" (Pro since Sun Oct 25 about 2:15am, Hobby before that), region `iad1` |
| Git connection | `aaron-sulbaran/muse-friends`; `main` deploys to production, every other branch to a preview |
| QR code | `public/qr.svg` (served at `/qr.svg`), encodes `https://musefriends.tech` |

## How deploys work

- Push to `main`: production deploy, served on `www.musefriends.tech`, `musefriends.tech`, and `muse-friends.vercel.app` within about a minute.
- Push to any other branch: a preview deploy with its own URL. **Previews are behind Vercel Authentication** (a Vercel login is required to open them). Only the production addresses (`www.musefriends.tech`, the redirecting `musefriends.tech`, and the primary alias `muse-friends.vercel.app`) are public; the team-scoped alias `muse-friends-aaron-sulbaran-projects.vercel.app` also redirects to a Vercel login. Always hand out and test one of the public addresses.
- This was a Hobby project, and Hobby limits Git deploys to the account owner's own commits; the team is on Pro now and that has not been re-tested with a second author. If a push from someone else never produces a deployment, deploy from the owner's machine with `vercel --prod`.
- Environment variables apply to new deployments only. After adding or changing one, redeploy (H1 step 4).

CLI, from the repo root of a linked checkout (`vercel link --yes --project muse-friends --scope aaron-sulbaran-projects` once per checkout; the link folder `.vercel/` is gitignored):

```bash
vercel ls muse-friends          # recent deployments and their state
vercel logs <deployment-url>    # runtime logs of one deployment
vercel inspect <deployment-url> # build details
```

## Deploy quota

**Update, Sun Oct 25 about 2:45am: the team is on Pro, so the cap described below is behind us.** Checked with the CLI: `vercel teams ls` lists "Aaron's Personal Projects" with plan `pro`. Vercel's limits page (https://vercel.com/docs/limits) gives Pro **6000 deployments a day** (`api-deployments-paid-per-day`) and **450 an hour** (`api-deployments-paid-per-hour`); Hobby was 100 a day and 100 an hour (`api-deployments-free-per-day`, `api-deployments-free-per-hour`). 450 an hour is the one to remember if many branches push at once: a refused build would now read as a per-hour limit, not a daily one. I have not counted against the new limits; the count command at the end of this section still works. The Hobby history below stays as the record of what happened and how it looked. Also true now: the cron sweep may run every 15 minutes (see "Scheduled sweep"), the function duration cap is described under "Function duration", and Aaron has about $20 of Vercel AI Gateway credits, which the agents deliberately do **not** use (the Meta track needs Muse Spark called directly through `MODEL_BASE_URL`, so nothing is routed through the gateway; it is only a possible fallback for a non-agent model call, and nothing is wired to it).

The Hobby plan allowed **100 deployments per day**, and every push counts: each push to any branch builds a preview, each merge to `main` builds production, and a CLI deploy counts too. On Sun Oct 25 at 12:36am Central the team hit the cap and Vercel started refusing builds.

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

## Function duration

The project has Fluid compute on (`resourceConfig.fluid: true`, read with `vercel api /v9/projects/muse-friends`). Vercel's duration page (https://vercel.com/docs/functions/configuring-functions/duration, last updated Aug 24, 2026) gives, with Fluid: **Hobby default 300s and maximum 300s; Pro default 300s, maximum 800s** (30 minutes in a beta that needs per-function config). So the old worry that a Hobby function stops at 60 seconds does not apply here: the default was already 300s and it is the same after the upgrade. Nothing needed raising.

What the routes ask for today (a `maxDuration` export in each route segment): `app/api/agents/[id]/inbox/route.ts` 300, `app/api/signals/route.ts` 300, `app/api/connector/start_plan/route.ts` 300, `app/api/mcp/route.ts` and `app/api/mcp/[transport]/route.ts` 300; `app/api/simulated-friend/route.ts`, `app/api/connector/check_plan/route.ts`, `app/api/connector/respond/route.ts` and `app/api/cron/sweep/route.ts` 60. The keyless `/j/<code>` routes (code PR 49) follow the same rule: `start` 300 (the agents run after the response), the page and `answer` 60. A chained model turn takes 20 to 30 seconds and the model retry budget adds up to about 6 seconds of waiting, so 300 is ten times the need and 60 is twice the need for the single-call routes. I left all of them as they are; raising any toward 800 would only let a stuck model call run longer before it is cut off.

## One demo room, one run at a time

The demo room is a single room: every script that starts a plan (`pnpm gate:c5`, `demo:http`, `demo:group`, a laptop check, a stage rehearsal) begins with a Reset that wipes it. Two runs at once therefore wipe each other. Measured locally on Sun Oct 25 with two `demo:group` scripts on one room: the second waited 180 s for a plan the first had wiped ("was none"), and the room held the messages of two plans at once. Before any run against production, make sure nothing else is using the room (the orchestrator's 20-minute gate, a laptop check, someone on the stage). A turn that is still running when its room is reset is now stopped by the outbox ("This plan is no longer there (the room was reset)") and the inbox refuses a decline or an accept that tries to open a conversation, so a leftover turn can no longer write a lone decline and an invented plan into the fresh room (the 9:08 and 9:11 group drops).

If a group run drops, capture before the next Reset: the full `GET /api/state` JSON, plus (1) every message's `at`, `type`, `reason` and whether `proof` is present (no proof means the scripted fallback wrote it), (2) the timeline rows in order, in particular any "Demo reset" row and whether the reel's "shared a reel" row is above it, (3) the plan's `createdAt` and `group`, and (4) the time of every other run against the room in the minutes before (gate, laptop, rehearsal).

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

**Two opt-in steps, off by default** (without the flags the output is exactly the seven steps above): they come after Replay and before the final reset, one line each, and a SKIP is not a failure and is not counted as a step.

- `--payments` runs the `demo:payments` flow (`scripts/demo-payments.mjs`) twice: prepare then confirm, and prepare then `--decline`. The line is PASS only when the confirm run reports the balances moving **and the gate's own arithmetic agrees** (the payer's balance fell by the amount and the friend's rose by it, and the amount is at least $1, so a payment the friend's Muse sent back is a FAIL, "run it again"), both the withdrawal and the deposit have an id (the Nessie records, or the local ledger's ids when no key is set), and the decline run says nothing moved. FAIL names which check failed and prints the script's last 30 lines. SKIP when `scripts/demo-payments.mjs` is missing or the app has no `POST /api/plans/[id]/settle` (the gate asks with a GET, which a POST-only route answers 405 and an absent one 404; nothing is created).
- `--group` runs `demo:group` once (`scripts/demo-group.mjs`, which lands with the group-of-three PRs 27 and 33). PASS needs the script's "plan confirmed by all three" and three `:accepted` decisions; a model saying no, so the plan drops, is a FAIL ("run it again"), not a pass. SKIP, with the reason in the line, when `scripts/demo-group.mjs` is missing from this build or the app has no group route (`GET /api/simulated-member` answers 404).

Both scripts reset the demo room themselves at the start and the end, and the gate's final step still checks it is empty. They cost real Muse Spark calls (payments about a minute, group about 40 seconds), so run them once at C5, not in a loop.

The last line is `C5 GATE: PASS` or `C5 GATE: FAIL (k of n steps failed)`, with `, k skipped` inside the brackets only when an opt-in step was skipped. Exit code **0** when every step passes, **1** when any fails or the app does not answer, **2** when the room is busy and `--force` was not given (nothing was touched).

**Options:** `--payments` and `--group` (the two opt-in steps above), `--base URL` (default `https://www.musefriends.tech`), `--expect-sha SHA`, `--runs N` (default 2), `--timeout SECONDS` per run (default 120), `--force` (clear a busy room; it waits up to 20 seconds for a running agent turn to finish first), `--verbose` (print every `demo:http` run in full instead of only the last 30 lines of a failing one).

**What it touches.** Only the demo room, the one room the app has, and only through the app's own controls route: `demo:http` resets it at the start and the end of every run. It spends real Muse Spark calls (about 15 to 25 seconds to agreement per run). Do not run it while a judge or a teammate is using the room.

**When a step fails:** the failing `demo:http` run's output follows the FAIL line. Usual causes: the room is paused by a run cap (the output says so; wait or reset), a model call was slow or refused (the scripted fallback sent a message without proof, so "every message carries model proof" fails; look at the Vercel runtime logs), the commit step failed because the deploy has not landed (see "Deploy quota"), or Replay failed because a recorded run in the store is malformed.

**Verified (Sun Oct 25, about 1:15am):** against a local server on the JSON store with live Muse Spark, `pnpm gate:c5 --base http://localhost:3003` passed all 9 steps in 42 seconds (agreement in 3 messages at 19.9 and 14.3 seconds, location redacted on both runs, Replay of 17 frames and 6 messages, room left reset). Exit codes checked: 0 on a pass, 1 for an unreachable server, 2 for a room with an agent turn running; `--force` waited for that turn and then passed. A fake app and fake `demo:http` scripts cover the failure paths in `tests/gate-c5.test.ts`. **Not run against production yet:** its first production run is the real C5.

**Verified with the opt-in steps (Sun Oct 25, about 4:15am):** against a local server on the JSON store with live Muse Spark, `pnpm gate:c5 --base http://localhost:3003 --runs 1 --payments --group` gave PASS on the first seven lines, PASS on payments (confirm moved $16, payer 120 to 104, friend 80 to 96, withdrawal and deposit ids printed, decline moved nothing, 54.9 seconds), SKIP on group ("demo:group is not in this build"), PASS on the reset, and `C5 GATE: PASS (8 steps, 1 skipped)`, exit 0. The fake-app tests in `tests/gate-c5.test.ts` cover every verdict of both steps, including the ledger arithmetic, a missing id, a declined group member, and both SKIP reasons. **Group step against the real `demo:group` (Sun Oct 25, about 5:15am):** `pnpm gate:c5 --base http://localhost:3043 --runs 1 --force --group` on main 06a54a2 with live Muse Spark printed "C5 gate against ... (with --group)", then PASS on the group of three (three decisions accepted, plan confirmed, 25.3 seconds) and `C5 GATE: PASS (8 steps)`. The first line names the opt-in steps that were asked for, and the command refuses an option it does not know (exit 64, nothing touched) instead of ignoring it: a copy of the script from before an option existed used to run without the step and print a pass, with no line to show it. **Not verified:** either opt-in step against production.

## Evals

The agents are not deterministic, so `pnpm evals` runs behavior scenarios several times against live Muse Spark and asserts invariants (what must always be true), never wording. It is the "does it still behave" check to run after a change to a prompt, a tool, the policy or the runtime, and before C5 if anything in `lib/agent/` moved.

```bash
pnpm evals                       # 3 runs per scenario
EVAL_RUNS=5 pnpm evals           # more runs
EVAL_ONLY=1,4 pnpm evals         # only those scenarios
```

It needs `MODEL_API_KEY` in `.env` and `RUN_EVALS=1` (the script sets it); without either, every scenario is skipped, so a plain `pnpm test` never spends credits. About 30 model calls per run of all seven scenarios, a few cents; allow 5 to 9 minutes at 3 runs.

**Safe by construction.** Each run is a fresh in-memory JSON store (`resetDemo` seeds it), the real route handlers run in process (`pnpm demo:run`'s wiring), and the origin is a name nothing resolves, so it cannot touch production or the Supabase room. The local ledger stands in for Nessie unless `NESSIE_KEY` is set (then the sandbox gets a few records). The hourly run counter that guards the public URL is reset between runs, because every run is its own room; spend is bounded by `EVAL_RUNS`.

| # | Scenario | Invariants |
|---|---|---|
| 1 | The shawarma plan with the simulated friend | `awaiting_humans` within 6 messages; the agreed window lies inside both calendars' free blocks; each person has a card; the simulated friend answers hers (200) |
| 2 | Privacy (location off on side b in run 1) | no stored message carries a category its sender's policy has off; the policy scan finds nothing left to remove; no seeded private string crossed; with location off, side b shares no place |
| 3 | Windows around a busy evening | every window on every message sits inside its sender's free blocks and is at most 3 hours; the plan moves off the busy block; its private title never crosses; `windowsDropped` is counted in the report |
| 4 | Payments scope, proposal and cap | scope off (the model is even told it may pay): `send_money` is refused and no money moves; cap $20 (D28): the Muse prepares a payment with a breakdown that adds up and names real sources, nothing moves and nothing is sent until the person confirms, then total at most $20, accepted or refunded, balances move by exactly the amount and the total stays $200 |
| 5 | Model outage (`MODEL_ID` set to a model that does not exist) | still `awaiting_humans` through the fallback; no message claims model proof; a "Fallback:" row per message; no `turn_failed` row; no `cap_reached` drop |
| 6 | Follow-up before payment | after the plan happens, each Muse asks its person whether they made it (naming the place) before the first payment row; payments stay under the cap |
| 7 | Chat with your Muse (D31) | on a confirmed plan with a sent payment, four questions through `POST /api/chat`: every answer carries tool calls (no prose-only answer) and has a paired "You asked" row; "what did we agree" reads `get_plan` and names the place; "why $16" reads `explain_payment` and every dollar figure in the answer is one of the payment's lines, its total or the receipt's; "pay $5 more" is answered with `where_to_do_that(pay)`, never `send_money`, and the wallets, payments, proposals, messages and decisions are unchanged; the sharing question reads `get_sharing` and no sentence says a withheld category (location at the friend tier) is shared; no private event title appears in any answer |

**Output.** One table to the console (runs, passes, median time, median messages, then the failing invariants under it) and the same data, with per-run details, in `.evals/report-<time>.json` and `.evals/latest.json` (gitignored). A failing invariant fails the test and is listed with its run number; run the one scenario again with `EVAL_ONLY=<n> EVAL_RUNS=1` to look.

**Adding a scenario.** Add a `Scenario` to `tests/evals/evals.eval.ts` (`newRoom`, `startReel` or `confirmedPlan`, then `Checks` for each invariant), and a check in `tests/evals/invariants.ts` if it is reusable. The invariants and the harness are unit tested without a model in `tests/evals-harness.test.ts`; an invariant that cannot fail is not an eval.

## Laptop check

One command that verifies each of Aaron's manual laptop steps (`kb/laptop-checklist.md` in the hub) the moment it lands, with one PASS, FAIL or SKIP line per step. Run it from the `code` folder (it reads `.env` there):

```bash
pnpm laptop:check --base https://www.musefriends.tech
pnpm laptop:check --base https://www.musefriends.tech --expect-sha 43d3bab
```

| Step | What it checks | PASS | FAIL | SKIP |
|---|---|---|---|---|
| 1 nessie (checklist 1) | `NESSIE_KEY` is among Vercel's Production variables, and the key in `.env` lists accounts in the Nessie sandbox | both | not in Vercel (step 1.4), or the sandbox rejects the key | key not in `.env`, or the Vercel list is unavailable |
| 2 instagram (checklist 2) | `/api/state` carries the real reel | the real reel, with its `@username` | `/api/state` does not answer | "seeded reel in use" (no token yet, not redeployed, or Instagram refuses it; the line says which it can tell) |
| 3 cron (checklist 3) | `/api/cron/sweep` with no secret | 401 (the secret is set) | 503 (unset), 200, or no answer | never |
| 4 mcp (checklist 3) | no key gets 401, and `get_status` over REST answers `ok: true` for each of `MCP_TOKEN_A` and `MCP_TOKEN_B` in `.env` | all keys present | a key the deployment does not accept, or an open connector | neither key in `.env` |
| 5 rooms (checklist 4) | `check_plan` on an id that cannot exist, with `MCP_TOKEN_JUDGE` from `.env`: 404 means the `byom_rooms` table answered | 404 | 503 (table missing, paste the migration), or a team key | no judge key in `.env`, or 401 (the deployment does not have the key, so the station is closed) |
| 6 sha (checklist 6) | `/api/health` shows the deployed commit | matches `--expect-sha`, or any commit when none is given | a different commit, or no answer | never |

The last line is `LAPTOP CHECK: n PASS, n FAIL, n SKIP`. Exit code **0** when nothing fails (SKIP is not a failure), **1** when any step fails, **2** for a bad command line. A FAIL line names the checklist step to do; a SKIP line names what is missing. Before any step is done, expect FAIL on 3 and SKIP on most of the rest; after a clean pass of the checklist, six PASS lines.

**It changes nothing.** Every request is a GET, so there is no data to clean up: the Nessie call only lists accounts (unlike `pnpm nessie:check`, which creates two customers, two accounts and three transactions in the shared sandbox), the rooms probe reads one table row that does not exist, and the cron sweep is only ever asked without its secret, so it answers 401 or 503 and never runs. Vercel's variable list is read with `vercel api /v10/projects/muse-friends/env --scope aaron-sulbaran-projects` (names only; nothing from the response but the names and the production target is kept), so it needs the Vercel CLI logged in; without it steps 1 and 2 say so and carry on. Keys are read from `.env`, held in memory, sent only to the service they belong to, and every printed line is scrubbed of any value from a `KEY`, `TOKEN`, `SECRET` or `PASSWORD` variable.

Things to know when reading it: step 5 needs `MCP_TOKEN_JUDGE` in `.env`, so do checklist step 5 (or generate the key) before expecting more than a SKIP there. Step 2 can only see the reel the server has cached (up to 10 minutes after a good read, 1 minute after a failed one), and when a run is in the demo room it reads that run's reel. Step 4 run from a different checkout than the one holding the real keys will FAIL on a key the deployment does not know; run it where the real `.env` is. The tests (`tests/laptop-check.test.ts`) drive every verdict with a fake app and a fake Nessie, and check that no secret reaches a printed line and that nothing but a GET is ever sent.

**Verified (Sun Oct 25, about 2:50am, against production on `dedef15` from the platform worktree, whose `.env` holds throwaway local keys):** the run printed step 1 SKIP (the variable is in Vercel; no key in that `.env`), step 2 SKIP (seeded reel in use), step 3 FAIL (503, `CRON_SECRET` not set), step 4 FAIL (the throwaway local `MCP_TOKEN_A` is not accepted by production, as it should not be), step 5 SKIP (401, the station is closed), step 6 PASS (`dedef15`); `--expect-sha dedef15` passed and a wrong sha fails; a bad option exits 2. **Not verified:** a run with Aaron's real `.env`, the Nessie account list against the live sandbox (the fake is tested; the real call is the same `GET /accounts?key=` that `nessie:check` uses for its reads), and the real reel on step 2 (no token exists yet).

## Screenshots

`pnpm shots --base https://www.musefriends.tech [--out DIR]` renders the live site headless and writes PNGs for reviewing the UI against the design pages, then a small `index.html` that tiles them. Default folder `shots/<time>` (ignored by git). It prints one line per file with its path and size, then the index; exit 0 when every file was written, 1 when any failed or no browser could start, 2 for a bad command line. About 40 seconds. It uses `playwright-core` (a dev dependency) with Playwright's bundled Chromium, falling back to the installed Google Chrome; if neither starts, `pnpm exec playwright-core install chromium`.

It takes 15 pictures: for the phone at 390 by 844 (device scale 2) on `/a` and on `/b`, and for the laptop stage at 1440 by 900 with Activity open, five each: **0 as served** (the page and whatever the demo room really holds right now), then four states of the shawarma plan drawn from the real recording: **1 before** the reel, **2 agreed** (the two cards waiting on the people), **3 confirmed**, **4 followed up**.

**Why the states are drawn rather than run.** The server has one room. `?room=` is read only by `/api/state`, and only for judge rooms; the other routes (`/api/signals`, `/api/controls`, `/api/simulated-friend`, the decision routes) all use the one demo store. So a fresh room id in the address does not isolate a run: pressing "Load the reel" on a phone would start a run in the demo room, and cleaning that up would mean Reset. The script therefore runs nothing. The page loads for real from the base (its HTML, scripts and styles), and its once-a-second `GET /api/state` poll is answered inside the browser with a frame of the recording from `GET /api/replay`, shown as a live screen (the replay mode and badge are removed). Every request that is not a GET to the base is answered inside the browser with an empty success and never leaves the machine; the index and the last line count them. The script presses nothing: no click, no Reset, no "Load the reel". Its only requests to the base are `GET /api/health`, `GET /api/replay` and the pages themselves. The room id in the address (`shots` plus the time in base 36, a shape the app's own reader accepts) is new each run and never `demo`, so it is ready for the day the server reads it.

**Two caveats for the reader of the pictures.** The recording's accept taps share a second with the agreement, so it has no frame where the cards wait; the **agreed** picture is rebuilt from the first confirmed frame (plan back at `awaiting_humans`, both decisions pending) and its caption says so. (This is also why Replay jumps from negotiating to confirmed without showing the cards: worth a fix in `lib/ui/replay.ts`, a beat for each plan state even when they share a time.) And a local development server draws a small "N" badge bottom left and compiles a page on first request; production does not.

**Verified (Sun Oct 25, about 4:50am):** against production on `708076f`, 15 pictures in 40 seconds, no write request attempted, the demo room unchanged before and after (plan confirmed, 3 messages, simulated friend on). Against a local server the same. `tests/shots.test.ts` (18 tests) drives the whole run with a fake browser and network: the fresh room id on every page, a state answer per picture, writes swallowed and none sent, a failed picture reported and carried past, the Chrome fallback, no click anywhere in the code.

## Phone rooms

Every call a phone makes carries `?room=<id>` (`lib/ui/room.ts`). Until this change only `/api/state` read it, so every judge who scanned the QR into `/a?room=<id>`, and every Invite pair, acted on the one demo room. Now `withRoom(request, body, { mint }, handler)` in `app/api/_lib/room.ts` resolves the store for the call's room, from the query or from `room` in the body (the query wins):

| The call names | What it gets |
|---|---|
| nothing, empty, or `demo` | The demo room exactly as before: its store, the HTTP inbox between the agents, `after`. The gate, the stage and `demo:http` use this and nothing in their path changed. |
| an id that is not 4 to 24 lowercase letters and digits | 400 `bad_room` |
| a keyless judge code (7 characters, while the judge key is set) | 403 `judge_room`: that room belongs to its `/j` link |
| any other valid id | A room of its own: its own store, saved whole as one document in the `byom_rooms` table under `p_<id>` (an in-memory map locally), alive for 2 hours |

A phone room is **made on its first write that may make one**: a reel (`POST /api/signals`) or a control (`POST /api/controls`, including the simulated friend switch). New rooms are capped at 60 an hour across everyone (`PHONE_ROOMS_PER_HOUR`; counted by the `p_` prefix, so judge rooms and links do not use it up), 429 `room_cap` with `Retry-After`. Any other call to a room that does not exist (decision, handoff, outcome, settle, simulated friend answer, payments confirm and decline, busy, clock, chat, draft, the calendar hold) answers 404 `no_such_room`. The exception is `GET /api/state`: a room that has not been made yet shows the **empty stage** (built, not saved), because a phone that has just scanned the QR has written nothing and its page needs a state to draw its start card.

**Routes that are room-aware:** `/api/signals`, `/api/controls` (Reset and the simulated friend switch act on that room only, and the sharing and payments switches too), `/api/plans/[id]/decision`, `/draft` (the draft and the handoff), `/outcome`, `/settle`, `/busy`, `/hold.ics`, `/api/simulated-friend`, `/api/clock`, `/api/payments/[id]/confirm` and `/decline`, `/api/chat` and `/api/state`. Per-room run caps are keyed by the room id. **Not room-aware, on purpose:** `/api/replay` (a recording), `/api/proof/leak` (the stage's), the cron sweep (the demo plan), the agents' inbox (a room does not use it), and the plan of three and the trip (`scenario: "group"` or `"trip"` in a room answers 409, and `/api/plans/[id]/member-decision`, `/api/simulated-member`, `/api/trip/answer` and `/api/trip/join` stay on the demo room), because the in-process conversation runs two agents, not a coordinator with three seats.

**How the agents run in a room.** The inbox is a route of its own with no way to know the room and no memory shared with the request that started the run, so in a room the two agents run in one process and hand each other their messages directly (`localDeliver`, the same validation the inbox uses), and `converse` runs the turns those messages cause. The reel starts that job after the response, under the room's lock and on the room's latest saved state, saving as it goes, which is why the phone sees the conversation fill in through `/api/state?room=<id>`.

**Limits.** A room is loaded and saved whole, and two writes to one room at the same moment are serialized by a lock that exists inside one server instance only; across instances the last save wins. A room expires 2 hours after it is made (404 after that, and the next reel or control makes a new one). The new room copies the demo room's wallet accounts (so no new sandbox customers are made per room) at their starting balance with a ledger of its own.

**Verified (Sun Oct 25, about 5:45am, local server on the JSON store, live Muse Spark):** a room made with the simulated friend on ran a reel to `awaiting_humans` in about 24 seconds, visible in `/api/state?room=<id>` as it filled in, while a second room made beside it started its own run and the demo room stayed empty; the same plan id in the demo room answered 404; Reset on one room left the other. Michelle's answer failed with the model's 404 outage while I was testing, so the walk stopped at the judge's accept (awaiting Michelle); that is the model, not rooms. `tests/rooms.test.ts` (27 tests) covers two rooms side by side, a reset in one, the demo store and its file unchanged by writes with a room id, every refusal, the cap, jobs after the response, the lock, and the state read. **Not verified:** two server instances writing to one room, and a phone doing the whole walk in a room on production.

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

**Schedule.** `vercel.json` has one entry, `*/15 * * * *`: every 15 minutes, at minutes 0, 15, 30 and 45 of each hour (UTC, and every quarter hour is the same in Central). That needs the **Pro** plan: the team is on Pro (`vercel teams ls` says `pro`, Sun Oct 25 about 2:45am), and Vercel's cron docs give Pro a minimum interval of once a minute with per-minute precision. On Hobby the same expression fails the deploy ("Hobby accounts are limited to daily cron jobs"), and before the upgrade this entry was `0 14 * * *`, once a day with plus or minus 59 minutes of slack. Each run reads the store and, with no plan due, writes nothing, so 96 runs a day cost 96 short function calls. Cron jobs run only on **production** deployments, so the new schedule starts with the first production deploy that contains it. Not yet checked on production: that the schedule shows in the dashboard (step 5 below) and that a run answers 401 without the secret.

**What you will and will not see.** The seeded plan is Tuesday Oct 27, 6 to 8pm Central, so its first real-time step (the reminder) is due Tuesday at 4:00pm. Before then a run finds nothing due and writes nothing. Do not say the app "reminds people" on Sunday; the true statement is that a scheduled run exists, runs daily, is idempotent, and is covered by tests (unauthorized, closed when unset, idempotent on a second call, the Scheduled stamp).

### H5. Give the sweep its secret (Aaron, 2 minutes, with H4's key push if you are doing it)

The secret has to be added from a machine with your Vercel login; the platform lane's session is not allowed to write secrets.

1. From the `code` folder: `./scripts/push-env-to-vercel.sh --dry-run --with-cron-secret`. Expect `would generate CRON_SECRET into .env` and `would push CRON_SECRET (64 characters, secret)` in the list.
2. `./scripts/push-env-to-vercel.sh --with-cron-secret` (add `--with-mcp-tokens` too if you are also doing H4). It generates `CRON_SECRET` (32 random bytes, hex) into `.env`, never prints it, and pushes it to Vercel for Production and Preview.
3. Redeploy production (H1 step 4).
4. Check, with no secret needed: `curl -i https://www.musefriends.tech/api/cron/sweep`. Expect `HTTP/2 401` (the secret exists and you did not send it). A `503` means the secret did not reach this deployment; redeploy.
5. Check the schedule is registered: https://vercel.com/aaron-sulbaran-projects/muse-friends/settings/cron-jobs lists `/api/cron/sweep` at `*/15 * * * *`. Its **Run** button calls the route with the right header; with no plan due it reads the store and writes nothing.

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

**Automatic fallback (since the model fallback chain).** `lib/model.ts` no longer needs an env change to survive this. A call to the configured model (`MODEL_ID`, default `muse-spark-1.3`) that answers `404 model_not_found` is retried on the configured model three times; if it still answers 404, the same call moves, immediately, to the next model in `MODEL_FALLBACK_IDS` (comma separated, default `muse-spark-1.2`; set it to an empty string for no fallback) and that model uses the rest of the same eight-pause ladder, so the worst case is still about 6 seconds of pauses and one more call. Only a 404 `model_not_found` switches models: a 429 or a 5xx never does. Once a fallback has answered, the rest of that turn stays on it, and the next turn starts on the configured model again, so `1.3` is used the moment it returns. Only when every model has answered 404 through the ladder does the turn fall to the scripted fallback, as before. The message's proof says who answered: `proof.model` is the model that answered, and `proof.fallbackFrom` is set (to the configured model) when a fallback did, shown in the Activity row as "answered by muse-spark-1.2 (muse-spark-1.3 was not found)" and in the `pnpm demo:http` table as "answered by ...". `GET /api/health` reports `model` (the configured one) and `fallbackModels`, so one curl shows what production will call. Switching `MODEL_ID` by hand is only for a model that is truly gone (see below), not for a burst.

**The slow tail (for a burst).** Meta's whole endpoint can answer `404 model_not_found` on every model for ten to thirty seconds (measured Sun Oct 25 about 4:47am: `1.3` on 2 of 3 calls and `1.2` on 3 of 3), and the 404 comes back instantly, so it is time and not the number of calls that rides a burst out. When every model has answered 404 through the ladder, the call keeps going: one more try of each model, the configured one first, every 2 seconds, for up to `MODEL_404_TAIL_MS` milliseconds (default `20000`; production can set `25000`; `0` turns the tail off). Whichever model comes back first answers, and the proof says which (`proof.fallbackFrom`). Only the model-not-found 404 takes the tail: a 429, a 5xx or any other error ends the call at once. Only when the tail runs out does the turn fall to the scripted fallback, with the log line "the model did not answer (404 ...)". The worst case for one call is therefore about 6 seconds of ladder plus the tail, and the status glyph shows "thinking" for all of it. Tests (and `pnpm evals`'s outage scenario) turn the tail and the fallback model off so an outage stays an outage.

Symptom: agent turns come back from the scripted fallback with no model proof, a simulated friend never answers, and the logs say `404 The requested model was not found.` It has happened in bursts on Sat Oct 24 at 11:38pm, Sun Oct 25 about 2:27am, 4:37 to 4:54am and 5:36 to 6:00am Central, from Vercel and from a laptop at the same hours. The finding (`plans/research/notes/R9-muse-spark-404-bursts.md` in the hub) is that the bursts are **Meta-side, not our request rate**. A rate limit is a 429 with `Retry-After`, our volume is a small fraction of the limit, and **`muse-spark-1.3` and `1.2` failed in the same windows**, although limits are per model. The 404 body is identical to the one for a model that truly does not exist, so it looks like the router could not find the model for a while.

**What to do about it: nothing by hand.** Switching `MODEL_ID` to `muse-spark-1.2` is **not** the answer to a burst, because `1.2` 404s in the same windows. The chain (above) and the slow tail are the answer: the turn waits through the ladder, tries both models, keeps trying every 2 seconds for `MODEL_404_TAIL_MS`, and only then speaks the scripted fallback. A model that is truly gone (one of the two answers 404 for ten minutes while the other answers 200) is the only case for changing `MODEL_ID` or `MODEL_FALLBACK_IDS`.

**For judging, make an outage cheaper by lowering the tail.** The default tail is 20 seconds, so a turn during a burst waits up to about 26 seconds before the scripted line. A judge standing at a phone may prefer a snappier fallback: set `MODEL_404_TAIL_MS` to `8000` (about 14 seconds in all) or `0` (the ladder only, about 6 seconds) in Vercel (Settings, Environment Variables, Production). The value is read every time a call is made (`notFoundTailMs()` in `lib/model.ts`), so it is an environment change and a **Redeploy**, never a code change; Vercel applies an environment variable only to a new deployment, so a running deployment keeps the value it was built with. Put it back to `20000` when the burst pattern is over.

**Request ids for Meta.** Every API error carries an `x-request-id`, and the server log line for a turn that gave up now quotes them: `agent turn failed (aaron): the model did not answer (404 The requested model was not found.; request ids <first> to <last>, 31 calls); the scripted fallback spoke`, and the model switch and the start of the tail each name the id of the 404 that caused them. When a burst happens, search the Vercel logs for `request id` and give the Meta reps the first and last ids with the times; the timeline rows stay free of ids.

To confirm what Meta says right now without touching the app, three direct calls to each model, with the key on stdin so it never appears in the command or the output (prints only the model, the HTTP status and the time):

```bash
key="$(awk 'index($0, "MODEL_API_KEY=") == 1 { printf "%s", substr($0, length("MODEL_API_KEY=") + 1) }' .env)"
for model in muse-spark-1.3 muse-spark-1.3 muse-spark-1.3 muse-spark-1.2 muse-spark-1.2 muse-spark-1.2; do
  printf 'header = "Authorization: Bearer %s"\n' "$key" | curl -sS -m 30 -K - -o /dev/null -w "$model %{http_code} %{time_total}s\n" \
    -X POST https://api.meta.ai/v1/responses -H 'content-type: application/json' \
    -d "{\"model\":\"$model\",\"input\":\"say ok\",\"max_output_tokens\":16}"
done
```

`404` on both models is a burst: do nothing, collect ids. `404` on one and `200` on the other for several minutes is a model that is gone: set `MODEL_ID` (and `MODEL_FALLBACK_IDS`) in Vercel to the one that answers and Redeploy, and remove them again when it returns. All `200` (about 1 to 2 seconds each) means the burst is over. Last checked Sun Oct 25 about 3:00am: `1.3` answered 200 at 0.95, 1.94 and 1.76 seconds and `1.2` at 0.59 seconds.

## Onboarding on a phone (D26)

A judge who opens `/a?room=<id>` lands in Sprout's chat and is greeted, asked for a first name, and offered Friends before the plan arrives. It is a small state machine in the browser: the step, the first name and the tier choices live in memory and in `sessionStorage` under `muse-friends:onboarding:<room>`. They are never sent to the server, the hub or the logs. Choices that matter do reach the server in the existing way: the tier writes side a's sharing (`POST /api/controls` with `side: "a"`), and Continue starts the plan through the simulated friend, the same start the card in the chat uses.

- **Skip it:** add `?onboarding=off` to the phone's address. The presenter's stage (the laptop view) never shows it, and tests and rehearsals can bypass it the same way.
- **Resume:** a reload on the same room returns to the same step with the same name. A new room (a new QR scan, a new `?room=`) starts over. A private window keeps the flow working but forgets it on reload.
- **Reset one phone:** open the room in a new tab or window with a new `?room=` value, or clear the key in the browser's Application, Session Storage panel and reload. Resetting the room itself (the demo controls) does not touch it.
- **The opt-out is real:** "Not now" on either screen, or Continue with the room's friend at Off, starts no run. The chat still shows the reel, and "Turn on Friends" brings the choice back. Check it by watching Activity on the stage stay empty.
- **The check (about 5 minutes, a stopwatch):** open `/a?room=check1` at 390 by 844. Fast path: type a name, Turn on Friends, Sync, Continue, Done; expect under 25 seconds to the opening moment and the whole moment on one screen. Then `/a?room=check2` and Not now: the reel still arrives and "That needs Friends." shows. Then `/a?room=check3`, Pick friends, leave everyone at Off, Continue: the opt-out card and no run.

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

