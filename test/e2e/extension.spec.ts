// Loads the built extension (dist/) into headless Chromium with every host name mapped to the local
// HTTPS fixture server, so Calmview's real compiled lists act on realistic pages. Never headed.
// Groups run side by side, each in its own browser; covers behaviour and looks (every surface in
// light and dark, screenshotted to test-results/ui/ and checked for contrast, icon size, overflow).
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer, VIDEO_ID, type FixtureServer } from "../harness";
import { settle, uiProblems } from "../ui-checks";

test.describe.configure({ mode: "parallel" });

// DIST=dist-store runs the same tests against the store build.
const dist = fileURLToPath(new URL(`../../${process.env.DIST ?? "dist"}`, import.meta.url));
const shots = fileURLToPath(new URL("../../test-results/ui", import.meta.url));
mkdirSync(shots, { recursive: true });
const SCHEMES = ["light", "dark"] as const;

interface Env {
  context: BrowserContext;
  worker: Worker;
  extId: string;
  server: FixtureServer;
}

async function launch(): Promise<Env> {
  const server = await startFixtureServer();
  const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "hush-")), {
    channel: "chromium",
    headless: true,
    ignoreHTTPSErrors: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, server.resolverRule, "--ignore-certificate-errors", "--autoplay-policy=no-user-gesture-required"],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extId = new URL(worker.url()).host;
  // Ready once the worker has applied settings (rulesets on, page-world scripts registered).
  await expect.poll(() => worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).length), { timeout: 20_000 }).toBeGreaterThan(0);
  return { context, worker, extId, server };
}

async function close(env?: Env): Promise<void> {
  await env?.context.close();
  await env?.server.close();
}

/** Without the "tabs" permission tests find a tab by bringing it to the front. */
async function tabIdOf(env: Env, p: Page): Promise<number> {
  await p.bringToFront();
  return env.worker.evaluate(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]!.id!);
}

async function check(page: Page, name: string, opts: { scope?: string } = {}): Promise<void> {
  await settle(page);
  await page.screenshot({ path: join(shots, `${name}.png`), fullPage: !opts.scope });
  expect(await uiProblems(page, opts), name).toEqual([]);
}

async function popup(env: Env, tabId: number, scheme: "light" | "dark" = "light"): Promise<Page> {
  const p = await env.context.newPage();
  await p.emulateMedia({ colorScheme: scheme });
  await p.setViewportSize({ width: 380, height: 600 });
  await p.goto(`chrome-extension://${env.extId}/popup.html?tab=${tabId}`);
  return p;
}

const hush = (p: Page) => p.evaluate(() => (window as unknown as { __hush: Record<string, unknown> }).__hush);

async function setSettings(env: Env, patch: Record<string, unknown>): Promise<void> {
  await env.worker.evaluate(async (patch) => {
    const { settings } = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({ settings: { ...(settings ?? {}), ...patch } });
  }, patch);
}

test.describe("blocking on a news site", () => {
  let env: Env;
  test.beforeAll(async () => void (env = await launch()));
  test.afterAll(async () => close(env));

  test("blocks ad and tracker requests, hides ad boxes, keeps the story", async () => {
    const p = await env.context.newPage();
    await p.goto(env.server.url("news.lantern.example"));
    await expect.poll(() => hush(p)).toMatchObject({ app: true });
    expect(await hush(p)).toEqual({ app: true });
    await expect(p.locator("#slot1")).toBeHidden();
    await expect(p.locator(".sponsored-post")).toBeHidden();
    await expect(p.locator("#story")).toBeVisible();
    await expect(p.locator("#related")).toBeVisible();
    const hosts = env.server.hits.map((h) => h.split("/")[0]);
    expect(hosts).not.toContain("adnxs.com");
    expect(hosts).not.toContain("static.hotjar.com");
    expect(hosts).not.toContain("pagead2.googlesyndication.com");
    expect(hosts).toContain("cdn.lantern.example");
    await p.close();
  });

  for (const scheme of SCHEMES) {
    test(`popup shows what was blocked (${scheme})`, async () => {
      const site = await env.context.newPage();
      await site.goto(env.server.url("news.lantern.example"));
      await expect.poll(() => hush(site)).toMatchObject({ app: true });
      const id = await tabIdOf(env, site);
      const pop = await popup(env, id, scheme);
      await expect(pop.getByText("On for news.lantern.example")).toBeVisible();
      await expect(pop.getByText(/things blocked on this page/)).toBeVisible();
      const chips = pop.locator(".chip");
      await expect(chips.filter({ hasText: /ad request/ })).toBeVisible();
      await expect(chips.filter({ hasText: /tracker/ })).toBeVisible();
      await expect(chips.filter({ hasText: /elements? hidden/ })).toBeVisible();
      expect(Number((await pop.locator(".count .big").textContent())?.replace(/,/g, ""))).toBeGreaterThanOrEqual(5);
      await check(pop, `popup-blocking-${scheme}`);
      await Promise.all([site.close(), pop.close()]);
    });
  }

  test("popup on a page Calmview can't touch says so", async () => {
    const own = await env.context.newPage();
    await own.goto(`chrome-extension://${env.extId}/options.html`);
    const id = await tabIdOf(env, own);
    for (const scheme of SCHEMES) {
      const pop = await popup(env, id, scheme);
      await expect(pop.getByText("Calmview can't work on this page")).toBeVisible();
      await check(pop, `popup-cant-run-${scheme}`);
      await pop.close();
    }
    await own.close();
  });
});

test.describe("pausing a site", () => {
  let env: Env;
  test.beforeAll(async () => void (env = await launch()));
  test.afterAll(async () => close(env));

  test("pausing lets ads through there, resuming blocks them again", async () => {
    const site = await env.context.newPage();
    await site.goto(env.server.url("news.lantern.example"));
    await expect.poll(() => hush(site)).toMatchObject({ app: true });
    const id = await tabIdOf(env, site);
    const pop = await popup(env, id);
    await pop.getByRole("switch", { name: "Block ads on news.lantern.example" }).click();
    // The tab reloads with Calmview paused: the ad script runs and the ad box shows.
    await expect.poll(() => hush(site).catch(() => ({})), { timeout: 15_000 }).toMatchObject({ adScript: true, tracker: true });
    await expect(site.locator("#slot1")).toBeVisible();
    for (const scheme of SCHEMES) {
      const p2 = await popup(env, id, scheme);
      await expect(p2.getByText("Paused on news.lantern.example")).toBeVisible();
      await check(p2, `popup-paused-${scheme}`);
      await p2.close();
    }
    const p3 = await popup(env, id);
    await p3.getByRole("switch", { name: "Block ads on news.lantern.example" }).click();
    await expect.poll(() => hush(site).catch(() => ({})), { timeout: 15_000 }).toEqual({ app: true });
    await expect(site.locator("#slot1")).toBeHidden();
    await Promise.all([site.close(), pop.close(), p3.close()]);
  });

  test("lighter blocking: requests still blocked, page left alone, and back", async () => {
    const site = await env.context.newPage();
    await site.goto(env.server.url("news.lantern.example"));
    await expect.poll(() => hush(site)).toMatchObject({ app: true });
    const id = await tabIdOf(env, site);
    for (const scheme of SCHEMES) {
      const pop = await popup(env, id, scheme);
      await pop.getByRole("button", { name: "Something not working on this site?" }).click();
      await expect(pop.getByText("1. Try lighter blocking")).toBeVisible();
      await check(pop, `popup-broken-${scheme}`);
      if (scheme === "dark") await pop.getByRole("button", { name: "Try it" }).click();
      await pop.close();
    }
    // The tab reloads: the ad box shows (nothing hidden), but the ad script still didn't load.
    await expect(site.locator("#slot1")).toBeVisible({ timeout: 15_000 });
    expect(await hush(site)).toEqual({ app: true });
    const p2 = await popup(env, id);
    await expect(p2.getByText("Lighter blocking on news.lantern.example")).toBeVisible();
    await check(p2, "popup-relaxed-light");
    await p2.getByRole("button", { name: "Back to full blocking" }).click();
    await expect(site.locator("#slot1")).toBeHidden({ timeout: 15_000 });
    await Promise.all([site.close(), p2.close()]);
  });

  test("switching Calmview off everywhere, and back on", async () => {
    await setSettings(env, { enabled: false });
    await expect.poll(() => env.worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())).toEqual([]);
    const site = await env.context.newPage();
    await site.goto(env.server.url("news.lantern.example"));
    await expect.poll(() => hush(site)).toMatchObject({ adScript: true });
    const id = await tabIdOf(env, site);
    for (const scheme of SCHEMES) {
      const pop = await popup(env, id, scheme);
      await expect(pop.getByText("Calmview is switched off")).toBeVisible();
      await check(pop, `popup-off-${scheme}`);
      if (scheme === "dark") {
        await pop.getByRole("button", { name: "Turn Calmview on" }).click();
        await expect(pop.getByText("On for news.lantern.example")).toBeVisible();
      }
      await pop.close();
    }
    await expect.poll(() => env.worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())).toEqual(["ads", "privacy", "malware", "cookies"]);
    await site.close();
  });
});

test.describe("hiding things yourself", () => {
  let env: Env;
  test.beforeAll(async () => void (env = await launch()));
  test.afterAll(async () => close(env));

  test("pick an element, hide it, it stays hidden, Show again brings it back", async () => {
    const site = await env.context.newPage();
    await site.setViewportSize({ width: 1000, height: 700 });
    await site.goto(env.server.url("news.lantern.example", "/clean"));
    const id = await tabIdOf(env, site);
    await env.worker.evaluate((id) => chrome.tabs.sendMessage(id, { type: "pick" }, { frameId: 0 }), id);
    await expect(site.locator("hush-picker")).toBeAttached();
    await site.locator(".card").hover();
    await site.locator(".card").click();
    const panel = site.locator("hush-picker .panel");
    await expect(panel.getByText("Hide this item?")).toBeVisible();
    for (const scheme of SCHEMES) {
      await site.emulateMedia({ colorScheme: scheme });
      await check(site, `picker-${scheme}`, { scope: "hush-picker" });
    }
    await panel.getByRole("button", { name: "Hide" }).click();
    await expect(site.locator(".card")).toBeHidden();
    await expect(site.locator("hush-toast .toast:not(.leaving)")).toContainText("Hidden on news.lantern.example");
    await check(site, "picker-toast-dark", { scope: "hush-toast" });
    await expect.poll(() => env.worker.evaluate(async () => ((await chrome.storage.local.get("settings")).settings as { userFilters?: string } | undefined)?.userFilters)).toMatch(/^news\.lantern\.example##.*card/);
    await site.reload();
    await expect(site.locator("#story")).toBeVisible();
    await expect(site.locator(".card")).toBeHidden();

    const pop = await popup(env, id);
    await expect(pop.getByText("1 thing you hid on this site.")).toBeVisible();
    await check(pop, "popup-hidden-light");
    await pop.getByRole("button", { name: "Show again" }).click();
    await expect(site.locator(".card")).toBeVisible({ timeout: 15_000 });
    await Promise.all([site.close(), pop.close()]);
  });

  test("your own filters block what you list", async () => {
    await setSettings(env, { userFilters: "||cdn.lantern.example^" });
    await expect.poll(() => env.worker.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).some((r) => r.condition.requestDomains?.includes("cdn.lantern.example")))).toBe(true);
    const site = await env.context.newPage();
    await site.goto(env.server.url("news.lantern.example"));
    await expect(site.locator("#story")).toBeVisible();
    await site.waitForLoadState("load");
    expect(await hush(site)).toEqual({});
    await setSettings(env, { userFilters: "" });
    await site.close();
  });
});

test.describe("YouTube", () => {
  let env: Env;
  test.beforeAll(async () => void (env = await launch()));
  test.afterAll(async () => close(env));

  const watch = (env: Env) => env.server.url("www.youtube.com", `/watch?v=${VIDEO_ID}`);

  test("ad slots are taken out of the player's data and ad boxes hidden", async () => {
    const p = await env.context.newPage();
    await p.goto(watch(env));
    await expect.poll(() => hush(p)).toMatchObject({ video: VIDEO_ID, adsInPlayer: false });
    await expect(p.locator("#player-ads")).toBeHidden();
    await expect(p.locator("#merch")).toBeHidden();
    await expect(p.locator("#shorts-shelf")).toBeVisible();
    await p.goto(env.server.url("www.youtube.com", "/"));
    await expect(p.locator("#feed-ad")).toBeHidden();
    await expect(p.locator("#feed-video")).toBeVisible();
    await p.close();
  });

  test("a video ad that plays anyway is muted, sped up and skipped; sound comes back", async () => {
    const p = await env.context.newPage();
    await p.goto(watch(env));
    await p.evaluate(async () => {
      const v = document.querySelector("video")!;
      v.muted = false;
      await v.play();
      document.getElementById("skip")!.style.display = "block";
      document.getElementById("movie_player")!.classList.add("ad-showing");
    });
    await expect.poll(() => p.evaluate(() => ({ muted: document.querySelector("video")!.muted, rate: document.querySelector("video")!.playbackRate }))).toEqual({ muted: true, rate: 16 });
    await expect.poll(() => hush(p)).toMatchObject({ skipClicked: expect.any(Number) });
    await p.evaluate(() => document.getElementById("movie_player")!.classList.remove("ad-showing"));
    await expect.poll(() => p.evaluate(() => ({ muted: document.querySelector("video")!.muted, rate: document.querySelector("video")!.playbackRate }))).toEqual({ muted: false, rate: 1 });
    await p.close();
  });

  test("the 'ad blockers aren't allowed' dialog is closed and the video resumes", async () => {
    const p = await env.context.newPage();
    await p.goto(watch(env));
    await p.evaluate(() => {
      const d = document.createElement("tp-yt-paper-dialog");
      d.innerHTML = "<ytd-enforcement-message-view-model>Ad blockers violate YouTube's Terms of Service</ytd-enforcement-message-view-model>";
      document.body.append(d);
      document.querySelector("video")!.pause();
    });
    await expect(p.locator("tp-yt-paper-dialog")).toHaveCount(0);
    await expect.poll(() => p.evaluate(() => document.querySelector("video")!.paused)).toBe(false);
    await p.close();
  });

  test("Hide Shorts, and sponsor segments skipped with Undo", async () => {
    await env.worker.evaluate(() => chrome.storage.local.set({ endpoints: { sponsorBlock: "https://sponsor.hush.test" } }));
    await setSettings(env, { youtube: { hideShorts: true, skipSponsors: true } });
    const p = await env.context.newPage();
    await p.setViewportSize({ width: 900, height: 600 });
    await p.goto(watch(env));
    await expect(p.locator("#shorts-shelf")).toBeHidden();
    await p.evaluate(async () => {
      const v = document.querySelector("video")!;
      await v.play();
    });
    await expect.poll(() => env.server.hits.find((h) => h.startsWith("sponsor.hush.test/"))).toMatch(/^sponsor\.hush\.test\/api\/skipSegments\/[0-9a-f]{4}\?categories=/);
    await p.evaluate(() => (document.querySelector("video")!.currentTime = 5));
    await expect.poll(() => p.evaluate(() => document.querySelector("video")!.currentTime)).toBeGreaterThanOrEqual(12);
    const t = p.locator("hush-toast .toast:not(.leaving)");
    await expect(t).toContainText("Skipped sponsor (8s)");
    for (const scheme of SCHEMES) {
      await p.emulateMedia({ colorScheme: scheme });
      await check(p, `sponsor-toast-${scheme}`, { scope: "hush-toast" });
    }
    await t.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => p.evaluate(() => document.querySelector("video")!.currentTime)).toBeLessThan(8);

    const id = await tabIdOf(env, p);
    for (const scheme of SCHEMES) {
      const pop = await popup(env, id, scheme);
      await expect(pop.getByRole("switch", { name: "Skip sponsor segments" })).toHaveAttribute("aria-checked", "true");
      await expect(pop.locator(".chip").filter({ hasText: /elements? hidden/ })).toBeVisible();
      await check(pop, `popup-youtube-${scheme}`);
      await pop.close();
    }
    await p.close();
  });
});

test.describe("dangerous and pop-up pages", () => {
  let env: Env;
  test.beforeAll(async () => void (env = await launch()));
  test.afterAll(async () => close(env));

  test("a malware site is stopped before it loads, and you can still continue", async () => {
    const p = await env.context.newPage();
    for (const scheme of SCHEMES) {
      await p.emulateMedia({ colorScheme: scheme });
      await p.goto(env.server.url("abcdserver.com")).catch(() => undefined);
      await expect(p).toHaveURL(new RegExp(`^chrome-extension://${env.extId}/blocked\\.html\\?g=malware#https://abcdserver\\.com`));
      await expect(p.getByText("abcdserver.com is on a malware and scam list")).toBeVisible();
      await check(p, `blocked-malware-${scheme}`);
    }
    expect(env.server.hits.some((h) => h.startsWith("abcdserver.com"))).toBe(false);
    await p.getByRole("button", { name: "Continue anyway" }).click();
    await expect(p.locator("#reached")).toHaveText("Reached abcdserver.com");
    await p.close();
  });

  test("an ad pop-up page is stopped", async () => {
    const p = await env.context.newPage();
    await p.goto(env.server.url("a-ads.com")).catch(() => undefined);
    await expect(p.getByText("a-ads.com is an ad or pop-up page")).toBeVisible();
    await check(p, "blocked-ad-light");
    await p.close();
  });

  test("video players get a harmless stand-in for the ad SDK", async () => {
    const p = await env.context.newPage();
    await p.goto(env.server.url("maharashtratimes.com"));
    await expect.poll(() => hush(p)).toMatchObject({ ima: "stand-in" });
    await p.close();
  });

  test("list scriptlets run in the page before its own scripts", async () => {
    const p = await env.context.newPage();
    await p.goto(env.server.url("www.sueddeutsche.de"));
    await expect.poll(() => p.evaluate(() => "spConfig" in (window as unknown as { __hush: object }).__hush)).toBe(true);
    expect(await hush(p)).toEqual({});
    await p.close();
  });
});

test.describe("settings", () => {
  let env: Env;
  test.beforeAll(async () => void (env = await launch()));
  test.afterAll(async () => close(env));

  for (const scheme of SCHEMES) {
    test(`settings page works and looks right (${scheme})`, async () => {
      const p = await env.context.newPage();
      await p.emulateMedia({ colorScheme: scheme });
      await p.setViewportSize({ width: 900, height: 900 });
      await p.goto(`chrome-extension://${env.extId}/options.html`);
      await expect(p.getByRole("switch", { name: "Annoyances" })).toHaveAttribute("aria-checked", "false");
      await expect(p.getByText(/lists from/)).toBeVisible();
      await check(p, `options-${scheme}`);
      if (scheme === "light") {
        await p.getByRole("switch", { name: "Annoyances" }).click();
        await expect.poll(() => env.worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())).toContain("annoyances");
        await expect.poll(() => env.worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id))).toContain("sl-annoyances");
        await p.getByRole("switch", { name: "Annoyances" }).click();
        await expect.poll(() => env.worker.evaluate(() => chrome.declarativeNetRequest.getEnabledRulesets())).not.toContain("annoyances");
        await p.locator("#filters").fill("||tracker.example^\nexample.com##+js(set, a, 1)");
        await p.getByRole("button", { name: "Save filters" }).click();
        await expect(p.getByText("1 filter in use.")).toBeVisible();
        await expect(p.getByText(/only run from the built-in lists/)).toBeVisible();
        await expect(p.locator(".list code", { hasText: "+js(" })).toHaveCount(0);
        await check(p, "options-filters-light");
      }
      await p.close();
    });
  }

  test("narrow settings page still fits", async () => {
    const p = await env.context.newPage();
    await p.setViewportSize({ width: 360, height: 800 });
    await p.goto(`chrome-extension://${env.extId}/options.html`);
    await expect(p.getByText("What Calmview blocks")).toBeVisible();
    await check(p, "options-narrow-light");
    await p.close();
  });
});
