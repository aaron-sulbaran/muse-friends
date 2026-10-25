#!/usr/bin/env node
// Screenshots of the live site, headless, for reviewing the UI against the design pages.
//
//   pnpm shots --base https://www.musefriends.tech
//   pnpm shots --base https://www.musefriends.tech --out /tmp/shots
//
// Options: --base URL   the deployed app (default https://www.musefriends.tech)
//          --out DIR    where the PNGs and index.html go (default shots/<time> under the current folder)
//
// It writes, for the phone at 390 by 844 (both sides, /a and /b) and the laptop stage at 1440 by 900 with Activity
// open: one picture of the page as the server really serves it, then the page in four states of the shawarma plan,
// before the reel, agreed (the cards waiting on the two people), confirmed, and followed up. One line per file, then
// a small index.html that tiles them all.
//
// READ ONLY, and it never touches the demo room. The server has one room, so a fresh ?room= id on its own does not
// isolate anything (only /api/state reads it, and only for judge rooms), and pressing "Load the reel" on a phone
// would run in the demo room. So the four states are not produced by running anything. The page loads for real from
// the base (its HTML, scripts and styles), and the one request it polls, GET /api/state, is answered in the browser
// with a frame of the real recording from GET /api/replay, shown as a live screen (no Replay badge). Every request
// that is not a GET to the base is answered in the browser with an empty success and never leaves the machine, so
// nothing can press Reset, send a reel, or answer a card. The count of those swallowed requests is printed.
//
// Exit code 0 when every file was written, 1 when any failed or no browser could start, 2 for a bad command line.

import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_BASE = "https://www.musefriends.tech";
export const PHONE = { width: 390, height: 844 };
export const LAPTOP = { width: 1440, height: 900 };

// The states of the plan to show, in order, and how to find each in the recording's frames.
const CONFIRMED_ISH = ["confirmed", "scheduled", "reminded"];

// The moment the two cards wait on the people. The recorded run's accept taps share a second with the agreement, so
// the recording can have no frame for it (Replay then jumps from negotiating to confirmed). When that happens the
// frame is rebuilt from the first confirmed one: the plan back at awaiting_humans, both decisions pending, and its
// history cut there. It is labelled as reconstructed wherever it appears.
export function agreedFrame(frames) {
  const real = frames.find((frame) => frame.snapshot.plan?.state === "awaiting_humans" && frame.snapshot.plan.decisions?.a === "pending" && frame.snapshot.plan.decisions?.b === "pending");
  if (real) return { snapshot: real.snapshot, reconstructed: false };
  const after = frames.find((frame) => CONFIRMED_ISH.includes(frame.snapshot.plan?.state));
  if (!after) return null;
  const plan = after.snapshot.plan;
  const cut = plan.history.findIndex((entry) => entry.state === "awaiting_humans");
  if (cut === -1) return null;
  return { snapshot: { ...after.snapshot, plan: { ...plan, state: "awaiting_humans", decisions: { a: "pending", b: "pending" }, history: plan.history.slice(0, cut + 1) } }, reconstructed: true };
}

export const STATES = [
  { key: "before", label: "before the reel", pick: (frames) => ({ snapshot: frames[0].snapshot, reconstructed: false }) },
  { key: "agreed", label: "agreed: the cards are waiting on the two people", pick: agreedFrame },
  {
    key: "confirmed",
    label: "confirmed: both said yes",
    pick: (frames) => {
      const frame = frames.find((entry) => CONFIRMED_ISH.includes(entry.snapshot.plan?.state));
      return frame ? { snapshot: frame.snapshot, reconstructed: false } : null;
    },
  },
  { key: "followed-up", label: "followed up: the plan happened", pick: (frames) => ({ snapshot: frames.at(-1).snapshot, reconstructed: false }) },
];

export function parseArgs(argv, now = new Date()) {
  const options = { base: process.env.SHOTS_BASE_URL ?? DEFAULT_BASE, out: null, help: false, error: null };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => argv[++index];
    if (argument === "--base") options.base = value();
    else if (argument === "--out") options.out = value();
    else if (argument === "--help" || argument === "-h") options.help = true;
    else options.error = `unknown option: ${argument}`;
  }
  if (typeof options.base !== "string" || !/^https?:\/\/[^\s/]+/.test(options.base)) options.error ??= "--base needs an address like https://www.musefriends.tech";
  else options.base = options.base.replace(/\/+$/, "");
  if (options.out === undefined || options.out === "") options.error ??= "--out needs a folder";
  options.out ??= path.join("shots", stamp(now));
  return options;
}

const pad = (value) => String(value).padStart(2, "0");
export const stamp = (date) => `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

// A new id each run, in the shape the app's own ?room= reader accepts (lowercase letters and digits, 4 to 24),
// and never "demo".
export function freshRoomId(nowMs = Date.now()) {
  return `shots${nowMs.toString(36)}`.slice(0, 24);
}

// The frame as a live screen: the same snapshot the Replay plays, but with the replay mode and its badge removed.
export function liveFrame(snapshot) {
  const live = { ...snapshot, mode: "live" };
  delete live.recording;
  return live;
}

export function pickStates(frames) {
  if (!Array.isArray(frames) || frames.length === 0) return [];
  return STATES.map((state) => {
    const picked = state.pick(frames);
    return picked ? { key: state.key, label: picked.reconstructed ? `${state.label} (reconstructed: the recording has no frame for it, both taps share a second)` : state.label, reconstructed: picked.reconstructed, snapshot: liveFrame(picked.snapshot) } : null;
  }).filter(Boolean);
}

const escapeHtml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function shotName(device, order, key) {
  return `${device}-${order}-${key}.png`;
}

export function indexHtml({ base, sha, roomId, startedAt, recording, shots, failures, blocked }) {
  const groups = [
    { device: "phone-a", title: "Phone, /a (Sprout), 390 by 844" },
    { device: "phone-b", title: "Phone, /b (Mochi), 390 by 844" },
    { device: "stage", title: "Laptop stage, 1440 by 900, Activity open" },
  ];
  const sections = groups
    .map(({ device, title }) => {
      const mine = shots.filter((shot) => shot.device === device);
      if (mine.length === 0) return "";
      const tiles = mine.map((shot) => `<figure><a href="${escapeHtml(shot.file)}"><img src="${escapeHtml(shot.file)}" alt="${escapeHtml(shot.caption)}" loading="lazy"></a><figcaption>${escapeHtml(shot.caption)}</figcaption></figure>`).join("\n");
      return `<h2>${escapeHtml(title)}</h2>\n<div class="row ${device === "stage" ? "wide" : "narrow"}">\n${tiles}\n</div>`;
    })
    .join("\n");
  const failed = failures.length > 0 ? `<p class="fail">Not written: ${failures.map((failure) => escapeHtml(`${failure.name} (${failure.reason})`)).join("; ")}</p>` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Muse Friends screenshots</title>
<style>
  body { font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 0; padding: 20px; background: #f3f4f6; color: #111; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 8px; }
  p { margin: 4px 0; color: #444; }
  .fail { color: #b00020; }
  .row { display: flex; gap: 14px; align-items: flex-start; overflow-x: auto; padding-bottom: 8px; }
  figure { margin: 0; flex: none; }
  .narrow img { width: 260px; }
  .wide img { width: 640px; }
  img { display: block; border-radius: 10px; box-shadow: 0 1px 6px rgba(0,0,0,.2); background: #fff; }
  figcaption { font-size: 12px; color: #555; margin-top: 6px; max-width: 260px; }
  .wide figcaption { max-width: 640px; }
</style>
</head>
<body>
<h1>Muse Friends screenshots</h1>
<p>Taken ${escapeHtml(startedAt)} from ${escapeHtml(base)}${sha ? ` (commit ${escapeHtml(sha)})` : ""}. Room id in the address: ${escapeHtml(roomId)}.</p>
<p>The first picture of each device is the page as the server really serves it. The other four are the live screen drawn from a frame of the recorded run${recording ? ` (${escapeHtml(recording)})` : ""}: nothing was run on the server, and ${blocked} write request${blocked === 1 ? "" : "s"} the page tried to make ${blocked === 1 ? "was" : "were"} answered inside the browser and never sent.</p>
${failed}
${sections}
</body>
</html>
`;
}

async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" } });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function launchBrowser(chromium) {
  const attempts = [{ label: "the bundled Chromium", options: {} }, { label: "the installed Google Chrome", options: { channel: "chrome" } }];
  const errors = [];
  for (const attempt of attempts) {
    try {
      return await chromium.launch({ headless: true, ...attempt.options });
    } catch (error) {
      errors.push(`${attempt.label}: ${String(error?.message ?? error).split("\n")[0].slice(0, 120)}`);
    }
  }
  throw new Error(`no browser could start (${errors.join("; ")}). Install one with: pnpm exec playwright-core install chromium`);
}

// The whole run. `deps` lets the tests stand in for the browser, the network and the clock.
export async function runShots(options, write = (line) => console.log(line), deps = {}) {
  const fetchImpl = deps.fetch ?? fetch;
  const nowMs = deps.now ?? Date.now();
  const roomId = freshRoomId(nowMs);
  const startedAt = new Date(nowMs).toISOString();
  const out = path.resolve(options.out);
  mkdirSync(out, { recursive: true });

  // Read only, from the base: which commit is serving, and the frames of the recording to draw.
  let sha = null;
  try {
    sha = (await getJson(fetchImpl, `${options.base}/api/health`)).body?.sha ?? null;
  } catch {
    sha = null;
  }
  let replay;
  try {
    const got = await getJson(fetchImpl, `${options.base}/api/replay`);
    replay = got.status === 200 ? got.body?.data : null;
  } catch {
    replay = null;
  }
  const states = pickStates(replay?.frames);
  if (states.length === 0) {
    write(`FAILED  no frames: GET ${options.base}/api/replay did not return a recording`);
    return 1;
  }
  const recording = replay.recordedAt ? `${replay.source} run recorded ${replay.recordedAt}` : null;

  const chromium = deps.chromium ?? (await import("playwright-core")).chromium;
  let browser;
  try {
    browser = await launchBrowser(chromium);
  } catch (error) {
    write(`FAILED  ${error instanceof Error ? error.message : error}`);
    return 1;
  }

  const shots = [];
  const failures = [];
  let blocked = 0;
  const devices = [
    { device: "phone-a", route: "/a", viewport: PHONE, scale: 2, mobile: true },
    { device: "phone-b", route: "/b", viewport: PHONE, scale: 2, mobile: true },
    { device: "stage", route: "/", viewport: LAPTOP, scale: 1, mobile: false },
  ];

  try {
    for (const item of devices) {
      const context = await browser.newContext({ viewport: item.viewport, deviceScaleFactor: item.scale, isMobile: item.mobile, hasTouch: item.mobile });
      const page = await context.newPage();
      let current = null; // the frame the page's state poll is answered with; null lets the real server answer
      await page.route("**/*", async (route) => {
        const request = route.request();
        const url = request.url();
        if (!url.startsWith(options.base)) return route.continue();
        if (request.method() !== "GET") {
          blocked += 1;
          return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {}, error: null }) });
        }
        if (current && new URL(url).pathname === "/api/state") {
          return route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(current) });
        }
        return route.continue();
      });

      const take = async (order, key, caption, settleMs) => {
        const file = shotName(item.device, order, key);
        const target = path.join(out, file);
        try {
          await page.waitForTimeout(settleMs);
          await page.screenshot({ path: target, fullPage: false });
          const bytes = statSync(target).size;
          shots.push({ device: item.device, file, caption });
          write(`${target}  (${item.viewport.width}x${item.viewport.height}, ${Math.max(1, Math.round(bytes / 1024))} KB)`);
        } catch (error) {
          failures.push({ name: file, reason: String(error?.message ?? error).split("\n")[0].slice(0, 100) });
          write(`FAILED  ${file}: ${failures.at(-1).reason}`);
        }
      };

      try {
        // The page as served: its own HTML and scripts, and whatever the server says the demo room holds right now.
        await page.goto(`${options.base}${item.route}?room=${roomId}`, { waitUntil: "domcontentloaded" });
        // A development server compiles a page on first request; wait until the page has drawn real content.
        await page.waitForFunction(() => (document.body?.innerText ?? "").trim().length > 80, null, { timeout: 45_000 }).catch(() => {});
        await take(0, "as-served", "as the server serves it right now (the real demo room, untouched)", 2500);
        // Then each state of the plan, by answering the state poll in the browser. The poll runs every second.
        let order = 1;
        for (const state of states) {
          current = state.snapshot;
          await take(order, state.key, state.label, 2200);
          order += 1;
        }
      } catch (error) {
        failures.push({ name: item.device, reason: String(error?.message ?? error).split("\n")[0].slice(0, 100) });
        write(`FAILED  ${item.device}: ${failures.at(-1).reason}`);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const indexFile = path.join(out, "index.html");
  writeFileSync(indexFile, indexHtml({ base: options.base, sha, roomId, startedAt, recording, shots, failures, blocked }));
  write(`${indexFile}  (tiles ${shots.length} picture${shots.length === 1 ? "" : "s"}; ${blocked} write request${blocked === 1 ? "" : "s"} swallowed in the browser, none sent; room id ${roomId})`);
  return failures.length === 0 ? 0 : 1;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log("usage: pnpm shots [--base URL] [--out DIR]");
    return 0;
  }
  if (options.error) {
    console.error(`${options.error}\nusage: pnpm shots [--base URL] [--out DIR]`);
    return 2;
  }
  return runShots(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main());
