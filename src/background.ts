// Service worker. Turns settings into Chrome's blocking engine (static rulesets + a few dynamic
// rules), registers the page-world scriptlets per site, serves each page its cosmetic CSS, keeps
// running totals, and answers the popup and settings page. Never opens tabs by itself.
import { listenForPromoPings } from "@mono/cross-promo/background";
import { compileUserFilters, type UserCompiled } from "./lib/user";
import { hideCss, keyedFor, planPage } from "./lib/cosmetic";
import type { CosmeticData } from "./lib/filters/compile";
import { PRIORITY, hostKeys } from "./lib/filters/compile";
import { GROUPS, type GroupId } from "./lib/groups";
import { getSettings, pausedEntry, relaxedEntry, siteOf, updateSettings, type Settings } from "./lib/settings";
import { addCounts, countMatches, emptyStats, type Kind, type Stats } from "./lib/stats";
import { isTwitch, isYouTube, TWITCH_AD_SELECTORS, YOUTUBE_AD_SELECTORS, YOUTUBE_HOSTS, YOUTUBE_SHORTS_SELECTORS } from "./lib/builtin";
import { matchPatterns, sponsorSegments } from "./lib/worker-helpers";

declare const __BUILD_ID__: string;
declare const __STORE__: boolean;

// Dev builds only: reload when a newer build lands in dist/ (see scripts/build.mjs).
if (!__STORE__) {
  void chrome.alarms.create("dev-reload", { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener(async (a) => {
    if (a.name !== "dev-reload") return;
    try {
      const latest = (await (await fetch(chrome.runtime.getURL("build-id.txt"), { cache: "no-store" })).text()).trim();
      if (latest && latest !== __BUILD_ID__) chrome.runtime.reload();
    } catch {
      /* dist/ is mid-rebuild; try again next time */
    }
  });
}

// ---------- compiled data (loaded lazily, kept while the worker lives) ----------

interface GroupData {
  pageBlocks: string[];
  cosmetic: CosmeticData;
  scriptletHosts: string[];
}
const groupCache = new Map<GroupId, Promise<GroupData>>();
function groupData(id: GroupId): Promise<GroupData> {
  let p = groupCache.get(id);
  if (!p) {
    p = fetch(chrome.runtime.getURL(`data/${id}.json`)).then((r) => r.json() as Promise<GroupData>);
    p.catch(() => groupCache.delete(id));
    groupCache.set(id, p);
  }
  return p;
}

let userCache: { text: string; compiled: UserCompiled } | undefined;
function userCompiled(s: Settings): UserCompiled {
  if (userCache?.text !== s.userFilters) userCache = { text: s.userFilters, compiled: compileUserFilters(s.userFilters) };
  return userCache.compiled;
}

async function cosmeticSets(s: Settings): Promise<CosmeticData[]> {
  const ids = GROUPS.filter((g) => s.groups[g.id]).map((g) => g.id);
  const sets = await Promise.all(ids.map(async (id) => (await groupData(id)).cosmetic));
  sets.push(userCompiled(s).cosmetic);
  return sets;
}

// Warm the data the first page will need as soon as the worker starts.
void getSettings().then((s) => cosmeticSets(s).catch(() => undefined));

// ---------- applying settings to Chrome ----------

const DYN = { paused: 1, pageBlockBase: 10, userBase: 1000 };
let applying: Promise<void> = Promise.resolve();

/** Brings rulesets, dynamic rules, registered scripts and the badge in line with settings. */
function apply(): Promise<void> {
  applying = applying.then(applyNow, applyNow);
  return applying;
}

async function applyNow(): Promise<void> {
  const s = await getSettings();
  const on = (id: GroupId) => s.enabled && s.groups[id];

  // 1. Static rulesets.
  const enable = GROUPS.filter((g) => on(g.id)).map((g) => g.id);
  const disable = GROUPS.filter((g) => !on(g.id)).map((g) => g.id);
  try {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: enable, disableRulesetIds: disable });
  } catch (e) {
    console.warn("Calmview: couldn't enable every ruleset", e);
  }

  // 2. Dynamic rules: paused sites, whole-page blocks (sent to blocked.html), the user's filters.
  const rules: chrome.declarativeNetRequest.Rule[] = [];
  if (s.enabled) {
    if (s.paused.length)
      rules.push({ id: DYN.paused, priority: PRIORITY.siteOff, action: { type: "allowAllRequests" }, condition: { requestDomains: s.paused, resourceTypes: ["main_frame"] } });
    for (const [i, g] of GROUPS.entries()) {
      if (!on(g.id)) continue;
      const { pageBlocks } = await groupData(g.id);
      if (!pageBlocks.length) continue;
      rules.push({
        id: DYN.pageBlockBase + i,
        priority: PRIORITY.pageBlock,
        action: { type: "redirect", redirect: { regexSubstitution: `${chrome.runtime.getURL("blocked.html")}?g=${g.id}#\\0` } },
        condition: { regexFilter: "^https?://.*", requestDomains: pageBlocks, resourceTypes: ["main_frame"] },
      });
    }
    userCompiled(s).rules.forEach((r, i) => rules.push({ ...r, id: DYN.userBase + i }));
  }
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map((r) => r.id), addRules: rules });
  } catch (e) {
    // A bad user filter mustn't take the built-in protection down with it.
    console.warn("Calmview: dynamic rules rejected, retrying without your filters", e);
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existing.map((r) => r.id), addRules: rules.filter((r) => r.id < DYN.userBase) });
  }

  // 3. Page-world scripts: scriptlets per group, and Calmview's YouTube layer.
  await registerScripts(s);

  // 4. Toolbar badge: Chrome counts blocked requests per tab by itself.
  await chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: s.enabled && s.badge });
  await chrome.action.setBadgeBackgroundColor({ color: "#4338ca" });
  await chrome.action.setTitle({ title: s.enabled ? "Calmview" : "Calmview is off" });
}

async function registerScripts(s: Settings): Promise<void> {
  const mine = await chrome.scripting.getRegisteredContentScripts();
  if (mine.length) await chrome.scripting.unregisterContentScripts({ ids: mine.map((m) => m.id) });
  if (!s.enabled) return;
  // Paused and lighter-blocking sites get no page-world scripts.
  const exclude = [...s.paused, ...s.relaxed].flatMap((h) => matchPatterns([h]));
  const scripts: chrome.scripting.RegisteredContentScript[] = [];
  for (const g of GROUPS) {
    if (!s.groups[g.id]) continue;
    const { scriptletHosts } = await groupData(g.id);
    const matches = matchPatterns(scriptletHosts);
    if (!matches.length) continue;
    scripts.push({ id: `sl-${g.id}`, js: [`scriptlets/${g.id}.js`], matches, excludeMatches: exclude, runAt: "document_start", world: "MAIN", allFrames: true, persistAcrossSessions: true });
  }
  if (s.groups.ads) scripts.push({ id: "yt-main", js: ["youtube-main.js"], matches: matchPatterns(YOUTUBE_HOSTS), excludeMatches: exclude, runAt: "document_start", world: "MAIN", allFrames: true, persistAcrossSessions: true });
  // Register one by one: one bad match pattern would otherwise reject them all.
  for (const sc of scripts) {
    try {
      await chrome.scripting.registerContentScripts([sc]);
    } catch (e) {
      console.warn(`Calmview: couldn't register ${sc.id}`, e);
    }
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await apply();
  const { stats } = await chrome.storage.local.get("stats");
  if (!stats) await chrome.storage.local.set({ stats: emptyStats() });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "hush-hide", title: "Hide this element with Calmview…", contexts: ["page", "image", "link", "frame", "video"] });
  });
});
chrome.runtime.onStartup.addListener(() => void apply());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) void apply();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "hush-hide" && tab?.id !== undefined) void chrome.tabs.sendMessage(tab.id, { type: "pick", fromMenu: true }, { frameId: info.frameId ?? 0 }).catch(() => undefined);
});
chrome.commands?.onCommand.addListener((cmd, tab) => {
  if (cmd === "hide-element" && tab?.id !== undefined) void chrome.tabs.sendMessage(tab.id, { type: "pick" }, { frameId: 0 }).catch(() => undefined);
});

// ---------- stats ----------

void chrome.alarms.create("stats", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "stats") void collectStats();
});

async function bumpStats(counts: Partial<Record<Kind, number>>, lastSeen?: number): Promise<void> {
  await navigator.locks.request("hush-stats", async () => {
    const { stats } = (await chrome.storage.local.get("stats")) as { stats?: Stats };
    let next = addCounts(stats ?? emptyStats(), counts);
    if (lastSeen) next = { ...next, lastSeen };
    await chrome.storage.local.set({ stats: next });
  });
}

/** Folds Chrome's record of matched rules (last 5 minutes) into the running totals. */
async function collectStats(): Promise<void> {
  try {
    const { stats } = (await chrome.storage.local.get("stats")) as { stats?: Stats };
    const after = stats?.lastSeen ?? 0;
    const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ minTimeStamp: after + 1 });
    const blocking = rulesMatchedInfo.filter((m) => m.rule.ruleId !== DYN.paused && !(m.rule.rulesetId === "_dynamic" && m.rule.ruleId >= DYN.userBase + 100000));
    const { counts, newest } = countMatches(blocking, after);
    if (newest > after) await bumpStats(counts, newest);
  } catch {
    /* feedback unavailable: totals just don't grow */
  }
}

// ---------- per-page cosmetics ----------

const YT_CSS = hideCss(YOUTUBE_AD_SELECTORS);
const SHORTS_CSS = hideCss(YOUTUBE_SHORTS_SELECTORS);
const TWITCH_CSS = hideCss(TWITCH_AD_SELECTORS);

function target(sender: chrome.runtime.MessageSender): chrome.scripting.InjectionTarget | null {
  if (sender.tab?.id === undefined) return null;
  return sender.documentId ? { tabId: sender.tab.id, documentIds: [sender.documentId] } : { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] };
}

async function insert(sender: chrome.runtime.MessageSender, css: string): Promise<void> {
  const t = target(sender);
  if (!t || !css) return;
  await chrome.scripting.insertCSS({ target: t, css, origin: "USER" }).catch(() => undefined);
}

/** The site a frame belongs to for pausing: the tab's top-level site. */
function topHost(sender: chrome.runtime.MessageSender, fallback: string): string {
  try {
    return new URL(sender.tab?.url ?? "").hostname || fallback;
  } catch {
    return fallback;
  }
}

async function pageConfig(url: string, sender: chrome.runtime.MessageSender) {
  const s = await getSettings();
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* about:blank and friends */
  }
  const top = topHost(sender, host);
  if (!s.enabled || !host || pausedEntry(s, top) || pausedEntry(s, host)) return { on: false };
  // Lighter blocking: requests are still blocked by Chrome's rules; the page itself is left alone.
  if (relaxedEntry(s, top) || relaxedEntry(s, host)) return { on: true, relaxed: true };
  const sets = await cosmeticSets(s);
  const plan = planPage(sets, host);
  const own: string[] = [];
  let css = hideCss(plan.hide) + (plan.styles.length ? `\n${plan.styles.join("\n")}` : "");
  const yt = isYouTube(host);
  if (yt && s.groups.ads) (css += `\n${YT_CSS}`), own.push(...YOUTUBE_AD_SELECTORS);
  if (yt && s.youtube.hideShorts) (css += `\n${SHORTS_CSS}`), own.push(...YOUTUBE_SHORTS_SELECTORS);
  if (isTwitch(host) && s.groups.ads) (css += `\n${TWITCH_CSS}`), own.push(...TWITCH_AD_SELECTORS);
  await insert(sender, css);
  return {
    on: true,
    keyed: plan.keyed,
    procedural: plan.procedural,
    specific: [...plan.specific, ...own],
    youtube: yt ? { ads: s.groups.ads, skipSponsors: s.youtube.skipSponsors } : null,
    twitch: isTwitch(host) && s.groups.ads,
  };
}

// ---------- popup ----------

async function tabState(tabId: number) {
  const s = await getSettings();
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  let host = "";
  try {
    const u = new URL(tab?.url ?? "");
    if (u.protocol === "http:" || u.protocol === "https:") host = u.hostname;
  } catch {
    /* not a web page */
  }
  const counts: Partial<Record<Kind, number>> = {};
  if (host) {
    try {
      const { rulesMatchedInfo } = await chrome.declarativeNetRequest.getMatchedRules({ tabId });
      Object.assign(counts, countMatches(rulesMatchedInfo.filter((m) => m.rule.ruleId !== DYN.paused), 0).counts);
    } catch {
      /* not available */
    }
  }
  await collectStats();
  const { stats } = (await chrome.storage.local.get("stats")) as { stats?: Stats };
  return {
    host,
    site: host ? siteOf(host) : "",
    enabled: s.enabled,
    paused: host ? !!pausedEntry(s, host) : false,
    relaxed: host ? !!relaxedEntry(s, host) : false,
    counts,
    youtube: host ? isYouTube(host) : false,
    settings: s,
    stats: stats ?? emptyStats(),
  };
}

// ---------- messages ----------

type Msg =
  | { type: "page"; url: string }
  | { type: "tokens"; url: string; tokens: string[] }
  | { type: "tab-state"; tabId: number }
  | { type: "set-site"; host: string; on: boolean; tabId?: number }
  | { type: "set-relaxed"; host: string; on: boolean; tabId?: number }
  | { type: "add-filter"; line: string }
  | { type: "remove-filters"; lines: string[] }
  | { type: "pick"; tabId: number }
  | { type: "skipped"; n: number }
  | { type: "hidden"; n: number }
  | { type: "sponsor"; videoId: string }
  | { type: "proceed"; url: string }
  | { type: "warm" };

chrome.runtime.onMessage.addListener((msg: Msg, sender, reply) => {
  const handle = async (): Promise<unknown> => {
    switch (msg?.type) {
      case "page":
        return pageConfig(msg.url, sender);
      case "tokens": {
        const s = await getSettings();
        const host = new URL(msg.url).hostname;
        const sels = keyedFor(await cosmeticSets(s), host, msg.tokens.slice(0, 5000));
        await insert(sender, hideCss(sels));
        return sels;
      }
      case "tab-state":
        return tabState(msg.tabId);
      case "set-site": {
        const site = siteOf(msg.host);
        await updateSettings((s) => {
          const entry = pausedEntry(s, msg.host);
          s.paused = msg.on ? s.paused.filter((p) => p !== entry && p !== site) : [...s.paused, site];
        });
        await apply();
        if (msg.tabId !== undefined) await chrome.tabs.reload(msg.tabId).catch(() => undefined);
        return true;
      }
      case "set-relaxed": {
        const site = siteOf(msg.host);
        await updateSettings((s) => {
          const entry = relaxedEntry(s, msg.host);
          s.relaxed = msg.on ? [...s.relaxed.filter((p) => p !== entry), site] : s.relaxed.filter((p) => p !== entry && p !== site);
        });
        await apply();
        if (msg.tabId !== undefined) await chrome.tabs.reload(msg.tabId).catch(() => undefined);
        return true;
      }
      case "add-filter": {
        const line = msg.line.trim();
        if (!line) return false;
        await updateSettings((s) => {
          const lines = s.userFilters.split("\n").filter((l) => l.trim());
          if (!lines.includes(line)) lines.push(line);
          s.userFilters = lines.join("\n");
        });
        return true;
      }
      case "remove-filters":
        await updateSettings((s) => {
          s.userFilters = s.userFilters
            .split("\n")
            .filter((l) => !msg.lines.includes(l.trim()))
            .join("\n");
        });
        return true;
      case "pick":
        await chrome.tabs.sendMessage(msg.tabId, { type: "pick" }, { frameId: 0 });
        return true;
      case "skipped":
        await bumpStats({ skipped: Math.max(0, Math.min(50, msg.n | 0)) });
        return true;
      case "hidden":
        return true;
      case "sponsor": {
        const { endpoints } = (await chrome.storage.local.get("endpoints")) as { endpoints?: { sponsorBlock?: string } };
        return sponsorSegments(msg.videoId, endpoints?.sponsorBlock);
      }
      case "proceed": {
        // The person chose to continue to a blocked page: allow that site in this tab for this session.
        const host = new URL(msg.url).hostname;
        const tabId = sender.tab?.id;
        const existing = await chrome.declarativeNetRequest.getSessionRules();
        const id = Math.max(0, ...existing.map((r) => r.id)) + 1;
        await chrome.declarativeNetRequest.updateSessionRules({
          addRules: [{ id, priority: PRIORITY.siteOff, action: { type: "allow" }, condition: { requestDomains: [host], resourceTypes: ["main_frame"], ...(tabId !== undefined ? { tabIds: [tabId] } : {}) } }],
        });
        return true;
      }
      case "warm":
        await cosmeticSets(await getSettings());
        return true;
    }
    return undefined;
  };
  handle().then(reply, (e) => reply({ error: String(e) }));
  return true;
});

// Make sure everything is in place after a browser restart that skipped onStartup (e.g. a crash).
void chrome.scripting.getRegisteredContentScripts().then((r) => {
  if (!r.length) void apply();
});

export { hostKeys };

// Lets the maker's other extensions see this one is installed, so they don't suggest it.
listenForPromoPings();
