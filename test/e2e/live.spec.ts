// LIVE=1 pnpm exec playwright test live — real sites, headless. For each site, loads it once without
// Calmview and once with it, and reports: requests blocked, visible text kept (a broken page loses most
// of its text), whether the page got sent to the blocked page, and on YouTube whether the player's
// data still carried ad slots. Results go to test-results/live.json and the README's findings.
import { chromium, expect, test, type BrowserContext } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test.skip(!process.env.LIVE, "set LIVE=1 to visit real sites");
test.setTimeout(15 * 60_000);

const dist = fileURLToPath(new URL("../../dist", import.meta.url));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
const SITES = [
  "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  "https://www.youtube.com/",
  "https://www.bbc.co.uk/news",
  "https://www.gov.uk/",
  "https://www.theguardian.com/uk",
  "https://www.independent.co.uk/",
  "https://www.dailymail.co.uk/home/index.html",
  "https://www.mirror.co.uk/",
  "https://www.amazon.co.uk/",
  "https://www.ebay.co.uk/",
  "https://www.argos.co.uk/",
  "https://www.tesco.com/",
  "https://en.wikipedia.org/wiki/Ad_blocking",
  "https://www.reddit.com/r/unitedkingdom/",
  "https://www.twitch.tv/",
  "https://www.dailymotion.com/gb",
  "https://github.com/",
  "https://www.nationwide.co.uk/",
  "https://www.rightmove.co.uk/",
  "https://www.metoffice.gov.uk/",
];

async function open(withHush: boolean): Promise<BrowserContext> {
  const args = withHush ? [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] : [];
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "hush-live-")), { channel: "chromium", headless: true, userAgent: UA, locale: "en-GB", viewport: { width: 1280, height: 900 }, args });
  if (withHush) {
    const w = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
    await expect.poll(() => w.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length), { timeout: 30_000 }).toBeGreaterThan(0);
  }
  return ctx;
}

async function visit(ctx: BrowserContext, url: string) {
  const p = await ctx.newPage();
  let blocked = 0;
  let requests = 0;
  p.on("request", () => requests++);
  p.on("requestfailed", (r) => {
    if (r.failure()?.errorText.includes("BLOCKED_BY_CLIENT")) blocked++;
  });
  let error = "";
  await p.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch((e) => (error = String(e).slice(0, 80)));
  await p.waitForTimeout(7000);
  const out = await p
    .evaluate(() => {
      const w = window as unknown as { ytInitialPlayerResponse?: Record<string, unknown> };
      const pr = w.ytInitialPlayerResponse;
      return {
        url: location.href,
        text: (document.body?.innerText ?? "").length,
        ytAds: pr ? !!(pr.adPlacements || pr.playerAds || pr.adSlots) : null,
        adShowing: !!document.querySelector("#movie_player.ad-showing"),
      };
    })
    .catch(() => ({ url: "", text: 0, ytAds: null, adShowing: false }));
  await p.close();
  return { ...out, blocked, requests, error, sentToBlockedPage: out.url.includes("blocked.html") };
}

test("live sweep", async () => {
  const plain = await open(false);
  const hush = await open(true);
  const rows = [];
  for (const url of SITES) {
    const a = await visit(plain, url);
    const b = await visit(hush, url);
    const kept = a.text ? Math.round((b.text / a.text) * 100) : null;
    const row = { url, requestsWithout: a.requests, requestsWith: b.requests, blocked: b.blocked, textKeptPct: kept, sentToBlockedPage: b.sentToBlockedPage, ytAdsWithout: a.ytAds, ytAdsWith: b.ytAds, error: b.error || a.error };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
  await plain.close();
  await hush.close();
  writeFileSync(fileURLToPath(new URL("../../test-results/live.json", import.meta.url)), JSON.stringify({ at: new Date().toISOString(), rows }, null, 1));
  // False-positive guard: no ordinary site may be sent to the blocked page.
  expect(rows.filter((r) => r.sentToBlockedPage)).toEqual([]);
});

// LIVE=1 … -g speed: page load time and data downloaded, with vs without Calmview (median of 3).
test("speed", async () => {
  const sites = (process.env.SITES ?? "https://www.theguardian.com/uk,https://www.independent.co.uk/,https://www.mirror.co.uk/,https://www.bbc.co.uk/news,https://en.wikipedia.org/wiki/Ad_blocking,https://www.gov.uk/,https://github.com/").split(",");
  const RUNS = Number(process.env.RUNS ?? 5);
  const measure = async (ctx: BrowserContext, url: string) => {
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    let bytes = 0;
    cdp.on("Network.loadingFinished", (e) => (bytes += e.encodedDataLength));
    await p.goto(url, { waitUntil: "load", timeout: 60_000 }).catch(() => undefined);
    await p.waitForTimeout(4000); // let late ad and tracker requests land
    // Sites can redirect mid-measurement (consent, regional editions): retry, then give up on this run.
    let t = { dcl: NaN, load: NaN };
    for (let i = 0; i < 3 && Number.isNaN(t.load); i++) {
      t = await p
        .evaluate(() => {
          const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
          return n && n.loadEventEnd ? { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : { dcl: NaN, load: NaN };
        })
        .catch(() => ({ dcl: NaN, load: NaN }));
      if (Number.isNaN(t.load)) await p.waitForTimeout(1500);
    }
    await p.close();
    return { ...t, kb: Math.round(bytes / 1024) };
  };
  const median = (xs: number[]) => {
    const ok = xs.filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
    return ok.length ? ok[Math.floor(ok.length / 2)] : NaN;
  };
  const rows: { url: string; withHush: boolean; load: number; dcl: number; kb: number }[] = [];
  const plain = await open(false);
  const hush = await open(true);
  for (const url of sites) {
    const runs: Record<string, { load: number; dcl: number; kb: number }[]> = { a: [], b: [] };
    // Alternate with and without, so network drift hits both equally.
    for (let i = 0; i < RUNS; i++) {
      runs.a.push(await measure(plain, url));
      runs.b.push(await measure(hush, url));
    }
    for (const [k, withHush] of [["a", false], ["b", true]] as const)
      rows.push({ url, withHush, load: median(runs[k].map((r) => r.load)), dcl: median(runs[k].map((r) => r.dcl)), kb: median(runs[k].map((r) => r.kb)) });
  }
  await plain.close();
  await hush.close();
  const table = sites.map((url) => {
    const a = rows.find((r) => r.url === url && !r.withHush)!;
    const b = rows.find((r) => r.url === url && r.withHush)!;
    return { site: new URL(url).hostname, loadMsWithout: a.load, loadMsWith: b.load, dclMsWithout: a.dcl, dclMsWith: b.dcl, kbWithout: a.kb, kbWith: b.kb };
  });
  console.table(table);
  writeFileSync(fileURLToPath(new URL("../../test-results/speed.json", import.meta.url)), JSON.stringify({ at: new Date().toISOString(), table }, null, 1));
});
