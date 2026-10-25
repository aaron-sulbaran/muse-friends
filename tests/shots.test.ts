import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agreedFrame, freshRoomId, indexHtml, liveFrame, parseArgs, pickStates, runShots, shotName, stamp } from "../scripts/shots.mjs";
import { buildReplay } from "@/lib/ui/replay";
import { recordedRun } from "@/lib/ui/replay-source";

type Plan = { state: string; decisions: { a: string; b: string }; history: Array<{ state: string }> };
type State = { key: string; label: string; reconstructed: boolean; snapshot: { mode: string; plan: Plan | null } };

// The real recording, drawn the way /api/replay serves it: its frames are what the screenshots show.
const replay = () => buildReplay(recordedRun()!);
const frames = () => replay().frames;

describe("parseArgs", () => {
  it("defaults to production and a timestamped folder under shots/", () => {
    const options = parseArgs([], new Date(2026, 9, 25, 4, 5, 6));
    expect(options).toMatchObject({ base: "https://www.musefriends.tech", out: path.join("shots", "20261025-040506"), error: null, help: false });
  });

  it("takes --base and --out, trims the base, and flags anything else", () => {
    expect(parseArgs(["--base", "http://localhost:3001///", "--out", "/tmp/x"])).toMatchObject({ base: "http://localhost:3001", out: "/tmp/x", error: null });
    expect(parseArgs(["--base", "musefriends.tech"]).error).toContain("--base");
    expect(parseArgs(["--nope"]).error).toContain("unknown option");
    expect(parseArgs(["--out"]).error).toContain("--out");
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(stamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("20260102-030405");
  });
});

describe("the room id", () => {
  it("is new each run, never demo, and in the shape the app's own ?room= reader accepts", () => {
    const first = freshRoomId(1_792_900_000_000);
    const second = freshRoomId(1_792_900_001_000);
    expect(first).not.toBe(second);
    for (const id of [first, second]) {
      expect(id).toMatch(/^[a-z0-9]{4,24}$/);
      expect(id).not.toBe("demo");
      expect(id.startsWith("shots")).toBe(true);
    }
  });
});

describe("the states drawn from the recording", () => {
  it("shows a live screen: the replay mode and its recording stamp are removed", () => {
    const frame = frames().at(-1)!.snapshot;
    expect(frame.mode).toBe("replay");
    expect(frame.recording).toBeDefined();
    const live = liveFrame(frame);
    expect(live.mode).toBe("live");
    expect(live).not.toHaveProperty("recording");
    expect(live.messages).toEqual(frame.messages);
  });

  it("picks before, agreed, confirmed and followed up from the real recording, in order", () => {
    const states = pickStates(frames()) as State[];
    expect(states.map((state) => state.key)).toEqual(["before", "agreed", "confirmed", "followed-up"]);
    const plans = states.map((state) => state.snapshot.plan?.state ?? null);
    expect(plans[0]).toBeNull();
    expect(plans[1]).toBe("awaiting_humans");
    expect(["confirmed", "scheduled", "reminded"]).toContain(plans[2]);
    expect(plans[3]).toBe("followed_up");
    for (const state of states) expect(state.snapshot.mode).toBe("live");
  });

  it("rebuilds the cards-waiting moment when the recording has no frame for it, and says so", () => {
    const real = frames();
    expect(real.some((frame) => frame.snapshot.plan?.state === "awaiting_humans" && frame.snapshot.plan.decisions.a === "pending" && frame.snapshot.plan.decisions.b === "pending")).toBe(false);
    const agreed = agreedFrame(real)!;
    expect(agreed.reconstructed).toBe(true);
    expect(agreed.snapshot.plan).toMatchObject({ state: "awaiting_humans", decisions: { a: "pending", b: "pending" } });
    expect(agreed.snapshot.plan!.history.at(-1)!.state).toBe("awaiting_humans");
    const label = (pickStates(real) as State[])[1].label;
    expect(label).toContain("reconstructed");
  });

  it("uses a real awaiting_humans frame, untouched, when the recording has one", () => {
    const real = frames();
    const withCards = [...real];
    const confirmed = real.find((frame) => frame.snapshot.plan?.state === "confirmed" || frame.snapshot.plan?.state === "scheduled")!;
    const waiting = { ...confirmed, snapshot: { ...confirmed.snapshot, plan: { ...confirmed.snapshot.plan, state: "awaiting_humans", decisions: { a: "pending", b: "pending" } } } };
    withCards.splice(withCards.indexOf(confirmed), 0, waiting as unknown as (typeof real)[number]);
    const picked = agreedFrame(withCards)!;
    expect(picked.reconstructed).toBe(false);
    expect(picked.snapshot).toBe(waiting.snapshot);
    expect((pickStates(withCards) as State[])[1].label).not.toContain("reconstructed");
  });

  it("gives nothing for no frames", () => {
    expect(pickStates([])).toEqual([]);
    expect(pickStates(undefined)).toEqual([]);
  });
});

describe("the index page", () => {
  it("tiles every picture under its device, names the commit, the room and the recording, and escapes what it prints", () => {
    const html = indexHtml({
      base: "https://x.test",
      sha: "2eb4a2b",
      roomId: "shotsabc",
      startedAt: "2026-10-25T09:00:00.000Z",
      recording: "live run recorded 2026-10-25T03:30:43-05:00",
      shots: [
        { device: "phone-a", file: "phone-a-0-as-served.png", caption: "as served" },
        { device: "stage", file: "stage-1-before.png", caption: "<b>before</b>" },
      ],
      failures: [{ name: "phone-b-2-agreed.png", reason: "timed out" }],
      blocked: 2,
    });
    expect(html).toContain('<img src="phone-a-0-as-served.png"');
    expect(html).toContain("Phone, /a (Sprout), 390 by 844");
    expect(html).toContain("Laptop stage, 1440 by 900, Activity open");
    expect(html).not.toContain("Phone, /b");
    expect(html).toContain("&lt;b&gt;before&lt;/b&gt;");
    expect(html).not.toContain("<b>before</b>");
    expect(html).toContain("commit 2eb4a2b");
    expect(html).toContain("shotsabc");
    expect(html).toContain("2 write requests the page tried to make were answered inside the browser and never sent");
    expect(html).toContain("Not written: phone-b-2-agreed.png (timed out)");
    expect(html.includes(String.fromCharCode(0x2014))).toBe(false);
  });

  it("names files by device, order and state", () => {
    expect(shotName("phone-a", 2, "agreed")).toBe("phone-a-2-agreed.png");
  });
});

// A stand-in for the browser: nothing starts, nothing is fetched, and every page records what it was asked to do.
function fakeBrowser(options: { failBundled?: boolean; failChrome?: boolean; failShot?: string } = {}) {
  const visited: string[] = [];
  const launches: Array<Record<string, unknown>> = [];
  const served: Array<{ file: string; state: { mode?: string; plan?: { state: string } | null } | null }> = [];
  const swallowed: Array<{ status: number }> = [];
  const contexts: Array<{ viewport: { width: number; height: number }; deviceScaleFactor: number }> = [];

  const chromium = {
    async launch(launchOptions: Record<string, unknown>) {
      launches.push(launchOptions);
      if (launchOptions.channel === "chrome" ? options.failChrome : options.failBundled) throw new Error(`launch failed: ${launchOptions.channel ?? "bundled"}\nstack`);
      return {
        async newContext(contextOptions: { viewport: { width: number; height: number }; deviceScaleFactor: number }) {
          contexts.push(contextOptions);
          let handler: ((route: unknown) => Promise<unknown>) | null = null;
          const page = {
            async route(_pattern: string, next: (route: unknown) => Promise<unknown>) {
              handler = next;
            },
            async goto(url: string) {
              visited.push(url);
              // The page makes a write request on load, as the real phone does when it starts a run on its own.
              const base = url.split("/").slice(0, 3).join("/");
              await handler!(fakeRoute("POST", `${base}/api/simulated-friend`, (reply) => swallowed.push(reply)));
            },
            async waitForFunction() {},
            async waitForTimeout() {},
            async screenshot(shot: { path: string }) {
              if (options.failShot && shot.path.endsWith(options.failShot)) throw new Error("page crashed\nmore");
              writeFileSync(shot.path, Buffer.from("89504e470d0a1a0a", "hex"));
              // Ask the way the page's poll does, and record what it would have been answered with.
              let state: { mode?: string; plan?: { state: string } | null } | null = null;
              let continued = false;
              await handler!(fakeRoute("GET", `${[...visited].at(-1)!.split("/").slice(0, 3).join("/")}/api/state?room=x`, undefined, (body) => (state = JSON.parse(body)), () => (continued = true)));
              served.push({ file: path.basename(shot.path), state: continued ? null : state });
            },
            async close() {},
          };
          return { async newPage() { return page; }, async close() {} };
        },
        async close() {},
      };
    },
  };
  return { chromium, visited, launches, served, swallowed, contexts };
}

function fakeRoute(method: string, url: string, onFulfill?: (reply: { status: number }) => void, onBody?: (body: string) => void, onContinue?: () => void) {
  return {
    request: () => ({ method: () => method, url: () => url }),
    async fulfill(reply: { status: number; body?: string }) {
      onFulfill?.(reply);
      if (reply.body && onBody) onBody(reply.body);
    },
    async continue() {
      onContinue?.();
    },
  };
}

function fakeFetch(options: { replay?: unknown | null; sha?: string | null } = {}) {
  const calls: string[] = [];
  const impl = async (url: string, init: { method?: string } = {}) => {
    calls.push(`${init.method ?? "GET"} ${url}`);
    if (url.endsWith("/api/health")) return new Response(JSON.stringify({ ok: true, sha: options.sha === undefined ? "2eb4a2b" : options.sha }), { status: 200 });
    if (url.endsWith("/api/replay")) return options.replay === null ? new Response("nope", { status: 500 }) : new Response(JSON.stringify({ data: options.replay ?? replay(), error: null }), { status: 200 });
    return new Response("not found", { status: 404 });
  };
  return { impl: impl as unknown as typeof fetch, calls };
}

describe("runShots", () => {
  const run = async (browserOptions: Parameters<typeof fakeBrowser>[0] = {}, fetchOptions: Parameters<typeof fakeFetch>[0] = {}) => {
    const dir = mkdtempSync(path.join(tmpdir(), "muse-shots-"));
    const lines: string[] = [];
    const browser = fakeBrowser(browserOptions);
    const net = fakeFetch(fetchOptions);
    const code = await runShots({ base: "https://app.test", out: dir }, (line: string) => lines.push(line), { chromium: browser.chromium, fetch: net.impl, now: 1_792_900_000_000 });
    return { code, lines, dir, browser, net };
  };

  it("writes fifteen pictures and an index, one line each, and exits 0", async () => {
    const { code, lines, dir } = await run();
    expect(code).toBe(0);
    const files = readdirSync(dir).sort();
    expect(files.filter((file) => file.endsWith(".png"))).toHaveLength(15);
    expect(files).toContain("index.html");
    expect(files).toContain("phone-b-2-agreed.png");
    expect(files).toContain("stage-4-followed-up.png");
    expect(lines).toHaveLength(16);
    expect(lines[0]).toBe(`${path.join(dir, "phone-a-0-as-served.png")}  (390x844, 1 KB)`);
    expect(lines.at(-1)).toContain("index.html  (tiles 15 pictures; 3 write requests swallowed in the browser, none sent;");
    const index = readFileSync(path.join(dir, "index.html"), "utf8");
    expect(index).toContain("commit 2eb4a2b");
    expect(index).toContain("live run recorded");
    expect(index).toContain("reconstructed");
  });

  it("uses a fresh room id on every page and never the demo room, with the phone and laptop sizes", async () => {
    const { browser } = await run();
    expect(browser.visited).toHaveLength(3);
    const ids = browser.visited.map((url) => new URL(url).searchParams.get("room"));
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/^shots[a-z0-9]{1,19}$/);
    expect(ids[0]).not.toBe("demo");
    expect(browser.visited.map((url) => new URL(url).pathname)).toEqual(["/a", "/b", "/"]);
    expect(browser.contexts.map((context) => `${context.viewport.width}x${context.viewport.height}@${context.deviceScaleFactor}`)).toEqual(["390x844@2", "390x844@2", "1440x900@1"]);
  });

  it("answers the page's state poll with each state of the plan, as a live screen, and lets the first picture see the real server", async () => {
    const { browser } = await run();
    const byFile = Object.fromEntries(browser.served.map((entry) => [entry.file, entry.state]));
    expect(byFile["phone-a-0-as-served.png"]).toBeNull();
    expect(byFile["stage-0-as-served.png"]).toBeNull();
    expect(byFile["phone-a-1-before.png"]?.plan ?? null).toBeNull();
    expect(byFile["phone-b-2-agreed.png"]?.plan?.state).toBe("awaiting_humans");
    expect(["confirmed", "scheduled", "reminded"]).toContain(byFile["stage-3-confirmed.png"]?.plan?.state);
    expect(byFile["stage-4-followed-up.png"]?.plan?.state).toBe("followed_up");
    for (const [file, state] of Object.entries(byFile)) if (state) expect(state.mode, file).toBe("live");
  });

  it("swallows every write the page makes, in the browser, and sends none to the base", async () => {
    const { browser, net } = await run();
    expect(browser.swallowed).toHaveLength(3);
    expect(browser.swallowed.every((reply) => reply.status === 200)).toBe(true);
    // The only requests the script itself makes are two GETs.
    expect(net.calls).toEqual(["GET https://app.test/api/health", "GET https://app.test/api/replay"]);
  });

  it("never presses anything: the code has no click, press, type or fill, and names no control", () => {
    const whole = readFileSync(new URL("../scripts/shots.mjs", import.meta.url), "utf8");
    // The comments explain what it avoids, by name; only the code is scanned for it.
    const code = whole.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    expect(code).not.toMatch(/\.(click|dblclick|tap|press|type|fill|check|dispatchEvent)\(/);
    expect(code).not.toMatch(/Reset|Load the (shawarma )?reel|Play with a simulated friend/);
    expect(whole.includes(String.fromCharCode(0x2014))).toBe(false);
  });

  it("reports a picture that could not be taken, carries on with the rest, lists it in the index, and exits 1", async () => {
    const { code, lines, dir } = await run({ failShot: "phone-b-2-agreed.png" });
    expect(code).toBe(1);
    expect(lines).toContain("FAILED  phone-b-2-agreed.png: page crashed");
    expect(readdirSync(dir).filter((file) => file.endsWith(".png"))).toHaveLength(14);
    expect(readFileSync(path.join(dir, "index.html"), "utf8")).toContain("Not written: phone-b-2-agreed.png (page crashed)");
  });

  it("falls back to the installed Chrome when the bundled browser will not start, and fails clearly when neither does", async () => {
    const fallback = await run({ failBundled: true });
    expect(fallback.code).toBe(0);
    expect(fallback.browser.launches.map((launch) => launch.channel ?? "bundled")).toEqual(["bundled", "chrome"]);

    const none = await run({ failBundled: true, failChrome: true });
    expect(none.code).toBe(1);
    expect(none.lines).toHaveLength(1);
    expect(none.lines[0]).toContain("no browser could start");
    expect(none.lines[0]).toContain("pnpm exec playwright-core install chromium");
  });

  it("stops with one line when the app has no recording to draw, without starting a browser", async () => {
    const { code, lines, browser } = await run({}, { replay: null });
    expect(code).toBe(1);
    expect(lines).toEqual(["FAILED  no frames: GET https://app.test/api/replay did not return a recording"]);
    expect(browser.launches).toEqual([]);
  });
});
