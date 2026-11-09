// Turns parsed filters into what the extension runs:
//   - declarativeNetRequest rules (thousands of "||host^" filters merged into a few rules),
//   - hosts whose pages are sent to Calmview's "blocked" page (ad pop-ups, malware),
//   - a cosmetic index (always-on CSS, CSS keyed by class/id, per-site CSS and procedural filters),
//   - scriptlet tables per site.
// Pure: used by the build (scripts/compile-lists) and by "My filters" at run time.
import { parseFilter, type CosmeticFilter, type Filter, type NetworkFilter, type ScriptletFilter } from "./parse";

type Rule = chrome.declarativeNetRequest.Rule;
type RuleNoId = Omit<Rule, "id">;

/** Redirect names used by filter lists → files Calmview ships in static/war/. */
export const RESOURCES: Record<string, string> = {
  noopjs: "noop.js",
  "noop.js": "noop.js",
  "popads.net.js": "noop.js",
  "popads.js": "noop.js",
  "chartbeat.js": "noop.js",
  "scorecardresearch_beacon.js": "noop.js",
  "scorecardresearch.com/beacon.js": "noop.js",
  "sensors-analytics.js": "noop.js",
  "outbrain-widget.js": "noop.js",
  nooptext: "noop.txt",
  "noop.txt": "noop.txt",
  noopframe: "noop.html",
  "noop.html": "noop.html",
  "noop.css": "noop.css",
  noopjson: "noop.json",
  "noop.json": "noop.json",
  "1x1.gif": "1x1.gif",
  "1x1-transparent.gif": "1x1.gif",
  "2x2.png": "2x2.png",
  "2x2-transparent.png": "2x2.png",
  "3x2.png": "2x2.png",
  "32x32.png": "32x32.png",
  "32x32-transparent.png": "32x32.png",
  "noopmp3-0.1s": "noop-0.1s.mp3",
  "noop-0.1s.mp3": "noop-0.1s.mp3",
  "noopmp4-1s": "noop-1s.mp4",
  "noop-1s.mp4": "noop-1s.mp4",
  "google-ima.js": "google-ima.js",
  "google-ima3": "google-ima.js",
  "googletagservices_gpt.js": "gpt.js",
  "googletagservices.com/gpt.js": "gpt.js",
  "googlesyndication_adsbygoogle.js": "adsbygoogle.js",
  "googlesyndication.com/adsbygoogle.js": "adsbygoogle.js",
  "google-analytics_analytics.js": "analytics.js",
  "google-analytics.com/analytics.js": "analytics.js",
  "google-analytics_ga.js": "analytics.js",
  "googletagmanager_gtm.js": "analytics.js",
  "googletagmanager.com/gtm.js": "analytics.js",
  "amazon_apstag.js": "apstag.js",
  "amazon-adsystem.com/aax2/amzn_ads.js": "apstag.js",
  "fingerprint2.js": "fingerprint2.js",
  "fuckadblock.js-3.2.0": "fuckadblock.js",
  "prebid-ads.js": "prebid-ads.js",
};

export const PRIORITY = {
  block: 1,
  removeparam: 2,
  redirect: 5,
  allow: 10,
  important: 30,
  pageBlock: 30,
  userBlock: 40,
  userAllow: 50,
  siteOff: 1000,
} as const;

export interface CosmeticData {
  /** Selectors applied on every page (can't be keyed by a class or id). */
  generic: string[];
  /** Selectors applied only when the page has this ".class" or "#id". */
  keyed: Record<string, string[]>;
  /** Site → CSS selectors to hide. Keys are hostnames or entities ("google.*"). */
  hide: Record<string, string[]>;
  /** Site → selectors that must NOT be hidden there (#@#). */
  unhide: Record<string, string[]>;
  /** Site → procedural filters for the content script. */
  procedural: Record<string, string[]>;
  /** Sites where cosmetic filtering is switched off: all of it, generic only, or site-specific only. */
  off: { all: string[]; generic: string[]; specific: string[] };
}

/** Site → scriptlet calls; `except` lists the exact calls (JSON of [name, ...args], or "*") switched off there. */
export interface ScriptletTable {
  run: Record<string, [string, ...string[]][]>;
  except: Record<string, string[]>;
}

export interface GroupResult {
  rules: Rule[];
  pageBlocks: string[];
  cosmetic: CosmeticData;
  scriptlets: ScriptletTable;
  stats: { network: number; merged: number; rules: number; regex: number; cosmetic: number; scriptlets: number; skipped: number };
}

const METHODS = new Set(["connect", "delete", "get", "head", "options", "patch", "post", "put", "other"]);

/** The text uBO compares $badfilter against: the filter with "badfilter" taken out of its options. */
export function badfilterKey(raw: string): string {
  const at = raw.lastIndexOf("$");
  if (at < 0) return raw;
  const opts = raw
    .slice(at + 1)
    .split(",")
    .filter((o) => o !== "badfilter")
    .sort();
  return opts.length ? `${raw.slice(0, at)}$${opts.join(",")}` : raw.slice(0, at);
}

/** Collects $badfilter keys across every list (they cancel filters in other lists too). */
export function collectBadfilters(texts: string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const line of t.split("\n")) if (line.includes("badfilter")) out.add(badfilterKey(line.trim()));
  return out;
}

export function networkRule(f: NetworkFilter, prio: { block: number; allow: number } = PRIORITY): RuleNoId | null {
  const condition: chrome.declarativeNetRequest.RuleCondition = {};
  if (f.regex) condition.regexFilter = f.regex;
  else if (f.host && !f.toDomains.length) condition.requestDomains = [f.host];
  else if (f.pattern) condition.urlFilter = f.pattern;
  if (f.matchCase) condition.isUrlFilterCaseSensitive = true;

  let types = [...new Set(f.types)];
  // $popup / $doc on a path pattern: "only pop-ups" can't be expressed, and blocking every page that
  // matches would be broader than the author meant. Pages blocked by host go to pageBlocks instead.
  // Rules that modify rather than block ($doc,removeparam=…, $doc,csp=…) keep main_frame.
  const modifies = f.removeparam !== undefined || f.csp !== undefined;
  if (f.page && !f.exception && !modifies) types = types.filter((t) => t !== "main_frame");
  if (f.types.length && !types.length) return null;
  if (types.length) condition.resourceTypes = types;
  else if (f.notTypes.length) condition.excludedResourceTypes = [...new Set(f.notTypes)];
  if (f.party) condition.domainType = f.party === "first" ? "firstParty" : "thirdParty";
  if (f.domains.length) condition.initiatorDomains = f.domains;
  if (f.notDomains.length) condition.excludedInitiatorDomains = f.notDomains;
  if (f.toDomains.length) condition.requestDomains = [...(condition.requestDomains ?? []), ...f.toDomains];
  if (f.notToDomains.length) condition.excludedRequestDomains = f.notToDomains;
  const methods = f.methods.filter((m) => METHODS.has(m));
  const notMethods = f.notMethods.filter((m) => METHODS.has(m));
  if (methods.length) condition.requestMethods = methods as chrome.declarativeNetRequest.RequestMethod[];
  if (notMethods.length) condition.excludedRequestMethods = notMethods as chrome.declarativeNetRequest.RequestMethod[];
  if (f.methods.length && !methods.length) return null;

  if (f.exception) {
    if (f.removeparam !== undefined || f.csp !== undefined || f.redirect) return null;
    const pageTypes = types.filter((t) => t === "main_frame" || t === "sub_frame");
    if (f.page && pageTypes.length === types.length) {
      condition.resourceTypes = ["main_frame", "sub_frame"];
      return { priority: prio.allow, action: { type: "allowAllRequests" }, condition };
    }
    return { priority: f.important ? prio.allow + 1 : prio.allow, action: { type: "allow" }, condition };
  }
  if (f.removeparam !== undefined) {
    // Only literal parameter names; "remove every parameter" and regexes are too blunt to convert.
    if (!/^[\w.[\]-]+$/.test(f.removeparam)) return null;
    if (!condition.resourceTypes) condition.resourceTypes = ["main_frame", "sub_frame", "xmlhttprequest"];
    return { priority: PRIORITY.removeparam, action: { type: "redirect", redirect: { transform: { queryTransform: { removeParams: [f.removeparam] } } } }, condition };
  }
  if (f.csp !== undefined) {
    if (!f.csp || /[\r\n]/.test(f.csp)) return null;
    condition.resourceTypes = ["main_frame", "sub_frame"];
    return { priority: prio.block, action: { type: "modifyHeaders", responseHeaders: [{ header: "content-security-policy", operation: "append", value: f.csp }] }, condition };
  }
  if (f.redirect) {
    const file = RESOURCES[f.redirect];
    if (file) return { priority: f.important ? PRIORITY.important + 1 : PRIORITY.redirect, action: { type: "redirect", redirect: { extensionPath: `/war/${file}` } }, condition };
    if (f.redirect === "none") return null;
  }
  return { priority: f.important ? PRIORITY.important : prio.block, action: { type: "block" }, condition };
}

/** Merges rules that differ only in requestDomains into one rule with all of those domains. */
export function mergeRules(rules: RuleNoId[]): RuleNoId[] {
  const out: RuleNoId[] = [];
  const groups = new Map<string, RuleNoId>();
  for (const r of rules) {
    const c = r.condition;
    const onlyHost = c.requestDomains?.length && !c.urlFilter && !c.regexFilter;
    if (!onlyHost) {
      out.push(r);
      continue;
    }
    const { requestDomains, ...rest } = c;
    const key = JSON.stringify([r.priority, r.action, rest]);
    const g = groups.get(key);
    if (g) g.condition.requestDomains!.push(...requestDomains!);
    else {
      const copy = { ...r, condition: { ...c, requestDomains: [...requestDomains!] } };
      groups.set(key, copy);
      out.push(copy);
    }
  }
  for (const g of groups.values()) g.condition.requestDomains = [...new Set(g.condition.requestDomains)].sort();
  return out;
}

/** Is a cosmetic selector a plain ".class" / "#id" lead we can key on? Returns that key. */
export function selectorKey(sel: string): string | null {
  const m = /^([.#])((?:[\w-]|\\.)+)/.exec(sel);
  if (!m) return null;
  // A top-level comma means several selectors: keying on the first would miss the others.
  if (/,(?![^(]*\))(?![^[]*\])/.test(sel)) return null;
  return m[1] + m[2].replace(/\\(.)/g, "$1");
}

const push = <T>(map: Record<string, T[]>, key: string, v: T) => void (map[key] ??= []).push(v);

export function compileGroup(texts: string[], opts: { badfilters?: Set<string>; maxRegex?: number; idBase?: number } = {}): GroupResult {
  const bad = opts.badfilters ?? collectBadfilters(texts);
  const stats = { network: 0, merged: 0, rules: 0, regex: 0, cosmetic: 0, scriptlets: 0, skipped: 0 };
  const rules: RuleNoId[] = [];
  const pageBlocks = new Set<string>();
  const cosmetic: CosmeticData = { generic: [], keyed: {}, hide: {}, unhide: {}, procedural: {}, off: { all: [], generic: [], specific: [] } };
  const scriptlets: ScriptletTable = { run: {}, except: {} };
  const genericUnhide = new Set<string>();
  const generic = new Set<string>();
  const seen = new Set<string>();

  for (const text of texts) {
    for (const line of text.split("\n")) {
      const raw = line.trim();
      if (!raw || raw[0] === "!" || seen.has(raw)) continue;
      seen.add(raw);
      let f: Filter | null;
      try {
        f = parseFilter(raw);
      } catch {
        f = null;
      }
      if (!f) {
        if (raw[0] !== "[" && raw[0] !== "!") stats.skipped++;
        continue;
      }
      if (f.kind === "network") {
        if (f.badfilter || bad.has(badfilterKey(raw))) continue;
        stats.network++;
        addNetwork(f, rules, pageBlocks, cosmetic, stats);
      } else if (f.kind === "cosmetic") {
        stats.cosmetic++;
        addCosmetic(f, cosmetic, generic, genericUnhide);
      } else {
        stats.scriptlets++;
        addScriptlet(f, scriptlets);
      }
    }
  }
  cosmetic.generic = [...generic].filter((s) => !genericUnhide.has(s));
  for (const s of cosmetic.generic.splice(0)) {
    const key = selectorKey(s);
    if (key) push(cosmetic.keyed, key, s);
    else cosmetic.generic.push(s);
  }
  for (const k of Object.keys(cosmetic.off) as (keyof CosmeticData["off"])[]) cosmetic.off[k] = [...new Set(cosmetic.off[k])];

  // Regex rules are capped by Chrome (1,000 per ruleset); keep the first ones (lists put important ones first).
  const maxRegex = opts.maxRegex ?? 900;
  let regexCount = 0;
  const kept = rules.filter((r) => !r.condition.regexFilter || ++regexCount <= maxRegex);
  stats.regex = Math.min(regexCount, maxRegex);
  const merged = mergeRules(kept);
  stats.merged = kept.length - merged.length;
  stats.rules = merged.length;
  const base = opts.idBase ?? 1;
  return {
    rules: merged.map((r, i) => ({ id: base + i, ...r })),
    pageBlocks: [...pageBlocks].sort(),
    cosmetic,
    scriptlets,
    stats,
  };
}

function addNetwork(f: NetworkFilter, rules: RuleNoId[], pageBlocks: Set<string>, cosmetic: CosmeticData, stats: GroupResult["stats"]): void {
  if (f.cosmeticOff) {
    const hosts = f.host ? [f.host] : f.domains.length && !f.pattern ? f.domains : [];
    cosmetic.off[f.cosmeticOff].push(...hosts);
    return;
  }
  if (f.exception && f.page && f.host && !f.domains.length && f.types.every((t) => t === "main_frame")) cosmetic.off.all.push(f.host);
  // Whole ad / malware hosts opened as pages go to the "blocked" page, which can say why.
  // Only plain blocks: "||reddit.com^$doc,removeparam=ref" cleans Reddit's links, it doesn't block Reddit.
  const plainBlock = !f.redirect && f.removeparam === undefined && f.csp === undefined;
  if (f.page && !f.exception && plainBlock && f.host && !f.domains.length && !f.notDomains.length && !f.party) pageBlocks.add(f.host);
  const r = networkRule(f);
  if (!r) {
    stats.skipped++;
    return;
  }
  rules.push(r);
}

function addCosmetic(f: CosmeticFilter, c: CosmeticData, generic: Set<string>, genericUnhide: Set<string>): void {
  const sites = f.domains.filter(Boolean);
  if (f.exception) {
    if (!sites.length) genericUnhide.add(f.selector);
    for (const d of sites) push(c.unhide, d, f.selector);
    return;
  }
  if (f.procedural) {
    // Generic procedural filters would run on every page: uBO doesn't either.
    for (const d of sites) push(c.procedural, d, f.selector);
    return;
  }
  if (!sites.length) {
    generic.add(f.selector);
    // "~site##.ad": generic, except on those sites.
    for (const d of f.notDomains) push(c.unhide, d, f.selector);
    return;
  }
  for (const d of sites) push(c.hide, d, f.selector);
  for (const d of f.notDomains) push(c.unhide, d, f.selector);
}

/** How an exception names the call it cancels: the exact call ("#@#+js(set, a, 1)"), or "*" for all. */
export function scriptletSig(name: string, args: string[]): string {
  return name ? JSON.stringify([name, ...args]) : "*";
}

function addScriptlet(f: ScriptletFilter, t: ScriptletTable): void {
  const sig = scriptletSig(f.name, f.args);
  if (f.exception) {
    for (const d of f.domains.length ? f.domains : ["*"]) push(t.except, d, sig);
    return;
  }
  if (!f.domains.length) return; // generic scriptlets: too risky to run on every site
  const call = [f.name, ...f.args] as [string, ...string[]];
  for (const d of f.domains) push(t.run, d, call);
  for (const d of f.notDomains) push(t.except, d, sig);
}

/** Hostname → the keys a site's filters may be stored under: itself, its parents, and entities. */
export function hostKeys(hostname: string): string[] {
  const labels = hostname.toLowerCase().replace(/\.$/, "").split(".");
  const keys: string[] = [];
  for (let i = 0; i < labels.length; i++) keys.push(labels.slice(i).join("."));
  // Entities: "google.*" matches google.com, google.co.uk… (any 1–2 label ending).
  for (let i = 0; i < labels.length - 1; i++)
    for (let end = labels.length - 1; end >= Math.max(i + 1, labels.length - 2); end--) keys.push(`${labels.slice(i, end).join(".")}.*`);
  return [...new Set(keys)];
}

/** Every filter in a block of text that parses, for "My filters" previews and counts. */
export function parseAll(text: string): { filters: Filter[]; bad: string[] } {
  const filters: Filter[] = [];
  const bad: string[] = [];
  for (const line of text.split("\n")) {
    const raw = line.trim();
    if (!raw || raw.startsWith("!")) continue;
    const f = parseFilter(raw);
    if (f) filters.push(f);
    else bad.push(raw);
  }
  return { filters, bad };
}
