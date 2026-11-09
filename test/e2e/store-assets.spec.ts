// Chrome Web Store images (ASSETS=1 pnpm store-assets) -> store/. Headless. Page screenshots are 24-bit
// RGB PNGs with no alpha, as the store requires. Sizes: screenshots 1280×800, small tile 440×280,
// marquee 1400×560. Use made-up brands only; never real shop logos or product photos you don't own.
import { chromium, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer, type FixtureServer } from "../harness";
import { BEST_FASTER, BEST_LESS_DATA, speedChartHtml } from "../speed-chart";

test.skip(!process.env.ASSETS, "set ASSETS=1 to render the store images");

const root = fileURLToPath(new URL("../..", import.meta.url));
const dist = join(root, "dist");
const out = join(root, "store");
const manifest = JSON.parse(readFileSync(join(root, "static/manifest.json"), "utf8"));
const NAME: string = manifest.short_name ?? manifest.name;
const ICON = `data:image/png;base64,${readFileSync(join(root, "static/icons/icon128.png")).toString("base64")}`;
const BRAND = "linear-gradient(125deg,#3730A3 0%,#1E40AF 55%,#0E7490 100%)";
const HEADLINE = "Ads gone.<br>Pages faster.";
const TAGLINE = `Up to ${BEST_FASTER}% faster pages · YouTube included · one switch per site · free and private`;

let context: BrowserContext;
let worker: Worker;
let extId: string;
let server: FixtureServer;

test.beforeAll(async () => {
  mkdirSync(out, { recursive: true });
  server = await startFixtureServer();
  context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "ext-assets-")), {
    channel: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    // Every host name resolves to the fixture server (made-up brands only in what's shown).
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, server.resolverRule, "--ignore-certificate-errors"],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  extId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  await server?.close();
});

/** Screenshot the popup for a tab and place it on a branded 1280×800 canvas with a caption. */
let sub = "";
async function framedPopup(page: Page, tabId: number, caption: string, file: string, before?: (p: Page) => Promise<void>): Promise<void> {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 640 });
  await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
  await popup.locator(".count, .site").first().waitFor();
  if (before) await before(popup);
  await popup.waitForTimeout(400);
  // Crop to the popup's content (a real popup is only as tall as what's in it).
  const shot = (await popup.locator("#app").screenshot()).toString("base64");
  await popup.close();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`<html><body style="margin:0;width:1280px;height:800px;overflow:hidden;background:${BRAND};font-family:system-ui,-apple-system,sans-serif;color:#fff;display:flex;align-items:center;gap:80px;padding:0 100px;box-sizing:border-box">
    <div style="flex:1"><div style="display:flex;align-items:center;gap:14px;margin-bottom:26px"><img src="${ICON}" width="56" height="56" style="border-radius:14px"><span style="font-size:30px;font-weight:800">${NAME}</span></div>
    <div style="font-size:46px;font-weight:800;line-height:1.1;letter-spacing:-0.02em">${caption}</div>${sub ? `<div style="font-size:22px;opacity:.9;margin-top:18px;line-height:1.4">${sub}</div>` : ""}</div>
    <img src="data:image/png;base64,${shot}" style="width:380px;border-radius:16px;box-shadow:0 30px 70px rgba(0,0,0,.35)"></body></html>`);
  await page.screenshot({ path: join(out, file) });
}

test("store images", async () => {
  const site = await context.newPage();
  await site.goto(server.url("news.lantern.example"));
  await site.waitForLoadState("load");
  await site.bringToFront();
  const tabId = (await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id))!;
  const page = await context.newPage();
  sub = "Ads, trackers, pop-ups and cookie banners, blocked on every site.";
  await framedPopup(page, tabId, `Ads gone.<br>Pages load up to<br>${BEST_FASTER}% faster.`, "screenshot-1.png");

  // 2. Speed, measured.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.setContent(`<html><body style="margin:0;width:1280px;height:800px;overflow:hidden;background:${BRAND};font-family:system-ui,-apple-system,sans-serif;color:#fff;display:flex;align-items:center;gap:60px;padding:0 80px;box-sizing:border-box">
    <div style="flex:1"><div style="display:flex;align-items:center;gap:14px;margin-bottom:26px"><img src="${ICON}" width="56" height="56" style="border-radius:14px"><span style="font-size:30px;font-weight:800">${NAME}</span></div>
    <div style="font-size:46px;font-weight:800;line-height:1.1;letter-spacing:-0.02em">Faster pages.<br>Less data.</div>
    <div style="font-size:21px;opacity:.92;margin-top:18px;line-height:1.45">Ads and trackers never download, so busy sites load up to ${BEST_FASTER}% faster and use up to ${BEST_LESS_DATA}% less data. Clean sites stay just as quick.</div></div>
    ${speedChartHtml(620)}</body></html>`);
  await page.screenshot({ path: join(out, "screenshot-2.png") });

  // 3. YouTube.
  await worker.evaluate(() => chrome.storage.local.get("settings").then(({ settings }) => chrome.storage.local.set({ settings: { ...(settings ?? {}), youtube: { skipSponsors: true, hideShorts: true } } })));
  const yt = await context.newPage();
  await yt.goto(server.url("www.youtube.com", "/watch?v=dQw4w9WgXcQ"));
  await yt.bringToFront();
  const ytTab = (await worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id))!;
  sub = "Video ads stripped out; any that slip through are muted and skipped. Optional: skip sponsor segments, hide Shorts.";
  await framedPopup(page, ytTab, "YouTube<br>without the ads.", "screenshot-3.png");

  // 4. Broken site? One click.
  await site.bringToFront();
  sub = "Lighter blocking keeps ads and trackers out but leaves the page alone. Or pause on that site.";
  await framedPopup(page, tabId, "Site acting up?<br>Fixed in one click.", "screenshot-4.png", async (p) => {
    await p.getByRole("button", { name: "Something not working on this site?" }).click();
  });

  // 5. Malware.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(server.url("abcdserver.com")).catch(() => undefined);
  await page.getByText("is on a malware and scam list").waitFor();
  await page.addStyleTag({ content: "body{zoom:1.45}" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(out, "screenshot-5.png") });

  const tile = (w: number, h: number, inner: string) =>
    `<html><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden;font-family:system-ui,-apple-system,sans-serif;background:${BRAND};color:#fff">${inner}</body></html>`;
  await page.setViewportSize({ width: 440, height: 280 });
  await page.setContent(tile(440, 280, `<div style="padding:34px 30px"><div style="display:flex;align-items:center;gap:12px"><img src="${ICON}" width="54" height="54" style="border-radius:14px"><span style="font-size:32px;font-weight:800">${NAME}</span></div>
    <div style="font-size:27px;font-weight:800;line-height:1.15;margin-top:22px">${HEADLINE}</div></div>`));
  await page.screenshot({ path: join(out, "promo-small.png") });
  await page.setViewportSize({ width: 1400, height: 560 });
  await page.setContent(tile(1400, 560, `<div style="display:flex;align-items:center;gap:60px;height:100%;padding:0 90px"><div style="flex:1;display:flex;flex-direction:column;justify-content:center">
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:30px"><img src="${ICON}" width="72" height="72" style="border-radius:18px"><span style="font-size:40px;font-weight:800">${NAME}</span></div>
    <div style="font-size:60px;font-weight:800;line-height:1.05;letter-spacing:-0.02em">${HEADLINE}</div>
    <div style="font-size:22px;opacity:.92;margin-top:22px;line-height:1.4">${TAGLINE}</div></div><div style="zoom:.82">${speedChartHtml(600)}</div></div>`));
  await page.screenshot({ path: join(out, "promo-marquee.png") });
});
