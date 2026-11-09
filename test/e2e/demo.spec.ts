// Demo video of every feature: DEMO=1 pnpm demo-video → store/demo.mp4 (1280×800, H.264).
// Headless Chromium records each scene (Playwright recordVideo) on the fixture sites (real host names
// mapped to the local server, made-up brands); captions and a cursor are drawn into the page, then
// ffmpeg trims the white first frames and joins the scenes.
import { chromium, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer, VIDEO_ID, type FixtureServer } from "../harness";
import { BEST_FASTER, BEST_LESS_DATA, speedChartHtml } from "../speed-chart";

test.skip(!process.env.DEMO, "set DEMO=1 to record the demo video");
test.setTimeout(10 * 60_000);

const root = fileURLToPath(new URL("../..", import.meta.url));
const dist = join(root, "dist");
const W = 1280;
const H = 800;
const ICON = `data:image/png;base64,${readFileSync(join(root, "static/icons/icon128.png")).toString("base64")}`;
const BRAND = "linear-gradient(125deg,#312e81 0%,#1e40af 55%,#0e7490 100%)";

let ctx: BrowserContext;
let worker: Worker;
let extId: string;
let server: FixtureServer;
const clips: { file: string; from: number }[] = [];
let sceneStart = 0;
let readyAt = 0;
/** Marks the moment the scene's page is fully drawn; the clip is trimmed to start here. */
const ready = () => void (readyAt = Date.now());
const rawDir = mkdtempSync(join(tmpdir(), "hush-demo-"));

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Caption bar and a visible cursor, drawn into the page (pointer-events: none, so nothing notices). */
async function decorate(p: Page): Promise<void> {
  if (!readyAt) ready();
  await p.evaluate(() => {
    if (document.getElementById("demo-cursor")) return;
    const c = document.createElement("div");
    c.id = "demo-cursor";
    c.style.cssText = "position:fixed;left:-50px;top:-50px;width:22px;height:22px;z-index:2147483647;pointer-events:none;transition:transform .08s";
    c.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.append(c);
    addEventListener("mousemove", (e) => Object.assign(c.style, { left: `${e.clientX - 3}px`, top: `${e.clientY - 2}px` }), true);
    addEventListener("mousedown", () => (c.style.transform = "scale(.8)"), true);
    addEventListener("mouseup", () => (c.style.transform = ""), true);
    const cap = document.createElement("div");
    cap.id = "demo-caption";
    cap.style.cssText =
      "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:2147483646;pointer-events:none;max-width:1000px;background:rgba(15,23,42,.92);color:#fff;font:600 22px/1.35 system-ui,-apple-system,sans-serif;padding:14px 26px;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.35);opacity:0;transition:opacity .35s;text-align:center";
    document.documentElement.append(cap);
  });
}

async function caption(p: Page, text: string, hold = 0, pos: "top" | "bottom" = "bottom"): Promise<void> {
  await decorate(p);
  await p.evaluate(([t, pos]) => {
    const cap = document.getElementById("demo-caption")!;
    cap.style.opacity = "0";
    cap.style.top = pos === "top" ? "24px" : "auto";
    cap.style.bottom = pos === "top" ? "auto" : "28px";
    setTimeout(() => {
      cap.textContent = t;
      cap.style.opacity = t ? "1" : "0";
    }, 200);
  }, [text, pos] as const);
  if (hold) await pause(hold);
}

/** Glide the cursor to an element (or a point) like a person would. */
async function glide(p: Page, target: string | { x: number; y: number }, click = false): Promise<void> {
  let x: number;
  let y: number;
  if (typeof target === "string") {
    const box = (await p.locator(target).first().boundingBox())!;
    x = box.x + box.width / 2;
    y = box.y + box.height / 2;
  } else ({ x, y } = target);
  await p.mouse.move(x, y, { steps: 28 });
  await pause(250);
  if (click) await p.mouse.click(x, y);
}

async function scene(fn: (p: Page) => Promise<void>): Promise<void> {
  const p = await ctx.newPage();
  sceneStart = Date.now();
  readyAt = 0;
  await p.setViewportSize({ width: W, height: H });
  await fn(p);
  const from = Math.max(0.5, ((readyAt || sceneStart) - sceneStart) / 1000 - 0.1);
  await pause(400);
  const video = p.video()!;
  await p.close();
  clips.push({ file: await video.path(), from });
}

async function card(p: Page, html: string, ms: number): Promise<void> {
  await p.setContent(`<html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;background:${BRAND};font-family:system-ui,-apple-system,sans-serif;color:#fff;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center">${html}</body></html>`);
  ready();
  await pause(ms);
}

/** Show the toolbar popup as a floating panel over a soft backdrop. */
async function framePopup(p: Page): Promise<void> {
  await p.addStyleTag({
    content: `html{background:${BRAND} !important;min-height:100%} body{zoom:1.3;margin:84px auto 0 !important;border-radius:14px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.45)} cross-promo{background:var(--x,#fff)} @media (prefers-color-scheme: dark){cross-promo{--x:#0f172a}}`,
  });
}

const tabIdOf = async (p: Page) => {
  await p.bringToFront();
  return worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]!.id!);
};
const setSettings = (patch: Record<string, unknown>) =>
  worker.evaluate(async (patch) => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...(settings ?? {}), ...patch } });
  }, patch);

test("record the demo video", async () => {
  server = await startFixtureServer();
  ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "hush-demo-profile-")), {
    channel: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    viewport: { width: W, height: H },
    recordVideo: { dir: rawDir, size: { width: W, height: H } },
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, server.resolverRule, "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required"],
  });
  worker = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  extId = new URL(worker.url()).host;
  for (let i = 0; i < 40 && !(await worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length)); i++) await pause(250);
  await worker.evaluate(() => chrome.storage.local.set({ endpoints: { sponsorBlock: "https://sponsor.hush.test" } }));
  const news = server.url("news.lantern.example", "/demo");

  // 1. Title.
  await scene((p) =>
    card(
      p,
      `<img src="${ICON}" width="120" height="120" style="border-radius:28px;box-shadow:0 20px 60px rgba(0,0,0,.35)">
       <div style="font-size:64px;font-weight:800;margin-top:28px;letter-spacing:-0.02em">Calmview</div>
       <div style="font-size:34px;font-weight:700;margin-top:10px;opacity:.95">Ads gone. Pages faster. YouTube included.</div>
       <div style="font-size:20px;margin-top:22px;opacity:.85">A free ad blocker for Chrome · simple · private</div>`,
      3500,
    ),
  );

  // 2. Before and after on a news site.
  await setSettings({ paused: ["news.lantern.example"] });
  await pause(800);
  await scene(async (p) => {
    await p.goto(news);
    await caption(p, "Without an ad blocker: banners, “sponsored” junk and trackers", 3200);
    await p.mouse.wheel(0, 260);
    await pause(1600);
  });
  await setSettings({ paused: [] });
  await pause(800);
  let newsTab = 0;
  await scene(async (p) => {
    await p.goto(news);
    await caption(p, "With Calmview: the same page, clean. Ads and trackers never even load.", 3600);
    await p.mouse.wheel(0, 260);
    await pause(1500);
    newsTab = await tabIdOf(p);
  });

  // Speed: why it's worth switching.
  await scene((p) =>
    card(
      p,
      `<div style="display:flex;align-items:center;gap:56px;padding:0 70px;text-align:left">
         <div style="flex:1"><div style="font-size:52px;font-weight:800;line-height:1.08;letter-spacing:-0.02em">Faster pages.<br>Less data.</div>
         <div style="font-size:24px;margin-top:18px;opacity:.92;line-height:1.45">Ads and trackers never download, so busy sites load up to ${BEST_FASTER}% faster and use up to ${BEST_LESS_DATA}% less data.</div></div>
         ${speedChartHtml(620)}</div>`,
      5200,
    ),
  );

  // 3. The popup: counts, suggestions from the same maker, and one switch per site.
  const newsPage = await ctx.newPage(); // keep a live tab for the popup to describe
  await newsPage.goto(news);
  newsTab = await tabIdOf(newsPage);
  await scene(async (p) => {
    await p.goto(`chrome-extension://${extId}/popup.html?tab=${newsTab}`);
    await framePopup(p);
    await caption(p, "Click the Calmview button: what was blocked on this page, by type", 1200, "top");
    await glide(p, ".chips");
    await pause(1800);
    await caption(p, "Plus a quiet suggestion from the same maker, with one-click install", 600, "top");
    await glide(p, "cross-promo");
    await pause(2400);
    await caption(p, "Site acting up? One switch pauses Calmview there", 1000, "top");
    await glide(p, ".switch", true);
    await p.locator("text=Paused on news.lantern.example").waitFor();
    await pause(2000);
    await glide(p, ".switch", true);
    await p.locator("text=On for news.lantern.example").waitFor();
    await caption(p, "…and back on, just as easily", 0, "top");
    // The tab reloads with Calmview on again; show its fresh count.
    await newsPage.waitForLoadState("load");
    await pause(1200);
    await p.reload();
    await framePopup(p);
    await decorate(p);
    await caption(p, "…and back on, just as easily", 2200, "top");
  });

  // 4. Hide anything.
  await scene(async (p) => {
    await p.goto(news);
    await caption(p, "Hide anything else: right-click → “Hide this element with Calmview”", 2600, "top");
    const id = await tabIdOf(p);
    await worker.evaluate((id) => chrome.tabs.sendMessage(id, { type: "pick" }, { frameId: 0 }), id);
    await p.locator("hush-picker").waitFor({ state: "attached" });
    await glide(p, "#story");
    await pause(500);
    await glide(p, "#related");
    await pause(700);
    await glide(p, "#related", true);
    await caption(p, "Point, click, Hide. It stays hidden on this site", 1800, "top");
    await glide(p, "hush-picker .panel .btn.primary", true);
    await pause(2600);
  });

  // 5. YouTube.
  const watch = server.url("www.youtube.com", `/watch?v=${VIDEO_ID}&demo=1`);
  await setSettings({ paused: ["youtube.com"] });
  await pause(800);
  await scene(async (p) => {
    await p.goto(watch);
    await caption(p, "YouTube without an ad blocker: sponsored boxes, merch shelves, video ads", 3400);
  });
  await setSettings({ paused: [] });
  await pause(800);
  await scene(async (p) => {
    await p.goto(watch);
    await caption(p, "With Calmview: ad slots are stripped before the player even sees them", 3400);
    await p.evaluate(async () => {
      const v = document.querySelector("video")!;
      v.muted = false;
      await v.play();
      document.getElementById("skip")!.style.display = "block";
      document.getElementById("movie_player")!.classList.add("ad-showing");
    });
    await caption(p, "If an ad slips through, it's muted, sped up 16× and skipped", 3200);
    await p.evaluate(() => {
      document.getElementById("movie_player")!.classList.remove("ad-showing");
      document.getElementById("skip")!.style.display = "none";
    });
    await caption(p, "…and your video carries on", 1800);
  });
  await setSettings({ youtube: { skipSponsors: true, hideShorts: true } });
  await pause(800);
  await scene(async (p) => {
    await p.goto(watch);
    await caption(p, "Optional extras: Hide Shorts, and skip sponsor segments", 2400);
    await p.evaluate(async () => {
      const v = document.querySelector("video")!;
      await v.play();
      await new Promise((r) => setTimeout(r, 600));
      v.currentTime = 4.2;
    });
    await caption(p, "Sponsor read skipped automatically, with Undo if you want it", 3600);
  });

  // 6. Malware.
  await scene(async (p) => {
    await p.goto(server.url("abcdserver.com")).catch(() => undefined);
    await p.locator("text=is on a malware and scam list").waitFor();
    await p.addStyleTag({ content: "body{zoom:1.45}" });
    await caption(p, "Scam and malware sites are stopped before they load", 2600);
    await glide(p, "text=Go back");
    await caption(p, "It tells you which list flagged it, and you stay in control", 2600);
  });

  // 7. Settings.
  await scene(async (p) => {
    await p.goto(`chrome-extension://${extId}/options.html`);
    await p.getByText("What Calmview blocks").waitFor();
    await p.addStyleTag({ content: "main{zoom:1.25}" });
    await pause(500);
    await caption(p, "Everything else in one calm Settings page", 2000);
    await glide(p, "#group-annoyances");
    await caption(p, "Ads, trackers, malware, cookie banners, annoyances: each one switch", 2600);
    await caption(p, "Your own filters, running totals and backups");
    for (let i = 0; i < 12; i++) {
      await p.mouse.wheel(0, 140);
      await pause(140);
    }
    await pause(2200);
    await caption(p, "And the maker's other free extensions");
    for (let i = 0; i < 14; i++) {
      await p.mouse.wheel(0, 150);
      await pause(140);
    }
    await pause(2600);
  });

  // 8. End card.
  await scene((p) =>
    card(
      p,
      `<img src="${ICON}" width="96" height="96" style="border-radius:22px">
       <div style="font-size:52px;font-weight:800;margin-top:22px">Calmview</div>
       <div style="font-size:28px;font-weight:600;margin-top:10px">Up to ${BEST_FASTER}% faster pages · Free · Nothing leaves your browser</div>
       <div style="margin-top:30px;background:#fff;color:#312e81;font-weight:800;font-size:24px;padding:14px 30px;border-radius:999px">Add to Chrome</div>`,
      3500,
    ),
  );
  await newsPage.close();
  await ctx.close();
  await server.close();

  // Join: trim each clip's blank first frames, normalise, concatenate.
  const out = join(root, "store");
  mkdirSync(out, { recursive: true });
  const parts: string[] = [];
  clips.forEach((c, i) => {
    const part = join(rawDir, `part-${i}.mp4`);
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-ss", c.from.toFixed(2), "-i", c.file, "-vf", `scale=${W}:${H},fps=30,format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-an", part]);
    parts.push(part);
  });
  const list = join(rawDir, "list.txt");
  writeFileSync(list, parts.map((p) => `file '${p}'`).join("\n"));
  execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", join(out, "demo.mp4")]);
  rmSync(rawDir, { recursive: true, force: true });
});
